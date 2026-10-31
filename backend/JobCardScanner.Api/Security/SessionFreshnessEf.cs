using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using JobCardScanner.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace JobCardScanner.Api.Security;

/// <summary>
/// 2026-10-23 (VAPT DMS-16): the two parts of the session checks that touch the database (SessionFreshness.cs holds the rest). Kept in their own file because they need Entity Framework.
///   * EfSessionUserLookup  - reads one user's role / active flag / dealer for SessionFreshnessMiddleware.
///   * UserChangeRevocationInterceptor - an EF Core SaveChanges interceptor: whenever a User row is DELETED or one of its role, active flag, dealer or password columns is MODIFIED, every session that user had so far
///     is ended (RevokedTokenStore.RevokeUser) - "server-side invalidation on password change and role change" - without UsersController, DealerAuthController or any other controller having to call anything.
///     It runs only after the save succeeded. Only these properties count (Role, Active, DealerId, PasswordHash / PasswordSalt / PasswordChangedAt / PasswordUpdatedAt, SecurityStamp) - a last-login time or a
///     counter of failed attempts does not end anybody's session.
/// Registered by AddAppSecurityEf(); Program.cs hands the interceptor to the DbContext (AddInterceptors).
/// </summary>
public sealed class EfSessionUserLookup : ISessionUserLookup
{
    private readonly JobCardScannerDbContext _db;

    public EfSessionUserLookup(JobCardScannerDbContext db) => _db = db;

    public async Task<SessionUserState?> FindAsync(Guid userId, CancellationToken ct)
    {
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.Role, u.Active, u.DealerId, u.Designation })
            .FirstOrDefaultAsync(ct);
        if (user is null) return null;
        // the dealer's BAPL dealer code (CUS0288 ...): lets the response filters recognise the caller's OWN dealer in lists that carry a code but no id
        string? baplCode = null;
        if (user.DealerId is Guid dealerId)
            baplCode = await _db.Dealers.AsNoTracking().Where(d => d.Id == dealerId).Select(d => d.BaplDmsDealerCode).FirstOrDefaultAsync(ct);
        return new SessionUserState(user.Role.ToString(), user.Active, user.DealerId, Convert.ToString(user.Designation), baplCode);
    }
}

public sealed class UserChangeRevocationInterceptor : SaveChangesInterceptor
{
    private static readonly Regex Sensitive = new("^(Role|Active|DealerId|PasswordHash|PasswordSalt|PasswordChangedAt|PasswordUpdatedAt|SecurityStamp)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly RevokedTokenStore _store;
    private readonly ConditionalWeakTable<DbContext, List<Guid>> _pending = new();

    public UserChangeRevocationInterceptor(RevokedTokenStore store) => _store = store;

    private void Collect(DbContext? context)
    {
        if (context is null) return;
        var ids = new List<Guid>();
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.Entity.GetType().Name != "User") continue;
            if (entry.State != EntityState.Modified && entry.State != EntityState.Deleted) continue;
            if (entry.State == EntityState.Modified && !entry.Properties.Any(p => p.IsModified && Sensitive.IsMatch(p.Metadata.Name))) continue;
            var id = entry.Properties.FirstOrDefault(p => p.Metadata.Name == "Id")?.CurrentValue;
            if (id is Guid g) ids.Add(g);
        }
        _pending.Remove(context);
        if (ids.Count > 0) _pending.Add(context, ids);
    }

    private void Flush(DbContext? context)
    {
        if (context is null || !_pending.TryGetValue(context, out var ids)) return;
        _pending.Remove(context);
        foreach (var id in ids) _store.RevokeUser(id);
    }

    private void Drop(DbContext? context)
    {
        if (context is not null) _pending.Remove(context);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Collect(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Collect(eventData.Context);
        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Flush(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Flush(eventData.Context);
        return base.SavedChangesAsync(eventData, result, cancellationToken);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        Drop(eventData.Context);
        base.SaveChangesFailed(eventData);
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        Drop(eventData.Context);
        return base.SaveChangesFailedAsync(eventData, cancellationToken);
    }
}

public static class SessionFreshnessEfExtensions
{
    /// <summary>builder.AddAppSecurityEf(); - right after builder.AddAppSecurity() in Program.cs.</summary>
    public static WebApplicationBuilder AddAppSecurityEf(this WebApplicationBuilder builder)
    {
        builder.Services.AddScoped<ISessionUserLookup, EfSessionUserLookup>();
        builder.Services.AddSingleton<UserChangeRevocationInterceptor>();
        return builder;
    }
}
