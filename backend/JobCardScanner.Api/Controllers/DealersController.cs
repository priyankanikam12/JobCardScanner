using JobCardScanner.Api.Auth;
using JobCardScanner.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace JobCardScanner.Api.Controllers;

[ApiController]
[Route("api/dealers")]
[Authorize(Policy = Policies.Staff)]
public class DealersController : ControllerBase
{
    private readonly JobCardScannerDbContext _db;
    public DealersController(JobCardScannerDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> List() =>
        Ok(await _db.Dealers.AsNoTracking().OrderBy(d => d.Name).ToListAsync());

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id)
    {
        var dealer = await _db.Dealers.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id);
        return dealer is null ? NotFound() : Ok(dealer);
    }
}
