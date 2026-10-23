using System.Collections.Concurrent;

namespace JobCardScanner.Api.Security;

/// <summary>Counts failed attempts per key (an account, a mobile number, an IP) and locks the key for a while after too many (VAPT DMS-11). In memory: one server process; a restart clears it.</summary>
public interface ILoginThrottle
{
    bool IsLocked(string key, out TimeSpan retryAfter);
    void RecordFailure(string key, int maxFailures, TimeSpan window, TimeSpan lockout);
    void RecordSuccess(string key);
}

public sealed class LoginThrottle : ILoginThrottle
{
    private sealed class Entry
    {
        public int Failures;
        public DateTimeOffset WindowStart;
        public DateTimeOffset? LockedUntil;
        public readonly object Gate = new();
    }

    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset _lastSweep = DateTimeOffset.UtcNow;

    public bool IsLocked(string key, out TimeSpan retryAfter)
    {
        retryAfter = TimeSpan.Zero;
        if (!_entries.TryGetValue(key, out var e)) return false;
        lock (e.Gate)
        {
            var now = DateTimeOffset.UtcNow;
            if (e.LockedUntil is { } until && until > now)
            {
                retryAfter = until - now;
                return true;
            }
            return false;
        }
    }

    public void RecordFailure(string key, int maxFailures, TimeSpan window, TimeSpan lockout)
    {
        var now = DateTimeOffset.UtcNow;
        var e = _entries.GetOrAdd(key, _ => new Entry { WindowStart = now });
        lock (e.Gate)
        {
            if (now - e.WindowStart > window)
            {
                e.Failures = 0;
                e.WindowStart = now;
            }
            e.Failures++;
            if (e.Failures >= maxFailures)
            {
                e.LockedUntil = now + lockout;
                e.Failures = 0;
                e.WindowStart = now;
            }
        }
        Sweep(now);
    }

    public void RecordSuccess(string key) => _entries.TryRemove(key, out _);

    private void Sweep(DateTimeOffset now)
    {
        if (now - _lastSweep < TimeSpan.FromMinutes(10) && _entries.Count < 20000) return;
        _lastSweep = now;
        foreach (var kv in _entries)
        {
            var e = kv.Value;
            lock (e.Gate)
            {
                var idle = now - e.WindowStart > TimeSpan.FromHours(1) && (e.LockedUntil is null || e.LockedUntil < now);
                if (idle) _entries.TryRemove(kv.Key, out _);
            }
        }
    }
}
