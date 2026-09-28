using System.ComponentModel.DataAnnotations;

namespace JobCardScanner.Api.Models;

// =====================================================================================
// SECTION 163 (2026-09-30) - "wants to create 1. service menu master ... in service menu master -
// which we added dependancy in jobcard which dependancy have 1st clieck Job Type * .. Service
// Head * .. Priority * this 3 dependancy wants to create in master table that create quey any i
// will add this manually and this dependancy fetch from this master table in jobcard in web and
// android".
//
// WHAT THIS REPLACES: web/src/pages/staff/JobCardWizardPage.tsx currently reads this exact
// 3-level cascade (Job Type -> Service Head -> Priority) from a hardcoded TypeScript file,
// web/src/data/serviceCatalog.ts (JOB_TYPES / SERVICE_HEADS / serviceHeadsForJobType). Priority
// itself is currently a completely separate, fixed 3-item dropdown
// (PRIORITY_OPTIONS = [['Normal','1'],['High','2'],['Urgent','3']]) that does NOT depend on Job
// Type or Service Head at all. mobile/src/screens/JobCardWizardScreen.tsx instead live-fetches
// Job Type/Service Head from BAPL DMS endpoints (/api/bapl-dms/job-types,
// /api/bapl-dms/service-heads/{id}) and has its own independent fixed Priority dropdown.
//
// This table is the single new source of truth for BOTH web and mobile going forward, replacing
// both of the above. One row = one valid (Job Type, Service Head, Priority) combination - you
// insert one row per combination you want selectable in the wizard. The read API (see
// ServiceMenuMasterController) derives the three cascading dropdowns from this one flat table by
// DISTINCT-ing on the relevant columns, the same way JobCardWizardPage.tsx's own
// serviceHeadsForJobType() helper works today.
//
// INTERPRETATION, flagged (Priority's data shape): you were asked whether Priority in the new
// master should depend on Job Type + Service Head, or stay independent as it is today. Your
// answer - "priority will int in string and also string also so this will depend on Job Type *
// and Service Head *" - confirms Priority DOES depend on Job Type + Service Head (a true 3-level
// cascade, not 2-level-plus-a-fixed-dropdown). The "int in string and also string also" part is
// read as: each Priority option needs BOTH a short code (e.g. "1"/"2"/"3", matching the numeric
// side of today's PRIORITY_OPTIONS) AND a display label (e.g. "Normal"/"High"/"Urgent", matching
// JobCardPriority's enum names) - hence the two separate PriorityValue/PriorityLabel columns
// below, mirroring the existing ['Normal','1'] tuple shape exactly so the wizard's JobCardPriority
// posting logic does not need to change. THIS IS AN ASSUMPTION, not a confirmed spec - if you
// meant something different by that phrase, tell me and I will adjust the column shape before
// you populate real rows (changing it later means re-doing whatever you've already inserted).
//
// Every column here mirrors an existing field name already used by the web wizard
// (baplJobTypeId/baplJobType, baplServiceHeadId/baplServiceHeadName) so plugging the new API in
// only requires swapping the DATA SOURCE, not the field names the rest of the page already posts
// to POST /api/jobcards.
// =====================================================================================

public class ServiceMenuMaster
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Matches the numeric Job Type id the wizard already posts as
    /// baplJobTypeId (e.g. Accidental/Major/Minor/Running Repair). Not an enum here - kept as a
    /// plain int + name pair, same as the JOB_TYPES catalog entries, since the actual valid set of
    /// Job Types is exactly what you insert into this table.</summary>
    [Required]
    public int JobTypeId { get; set; }

    [Required, MaxLength(60)]
    public string JobTypeName { get; set; } = default!;

    [Required]
    public int ServiceHeadId { get; set; }

    [Required, MaxLength(120)]
    public string ServiceHeadName { get; set; } = default!;

    /// <summary>Short code posted/matched against, e.g. "1"/"2"/"3" - see class doc comment's
    /// Priority-shape Assumption.</summary>
    [Required, MaxLength(10)]
    public string PriorityValue { get; set; } = default!;

    /// <summary>Display label, e.g. "Normal"/"High"/"Urgent" - expected to match
    /// JobCardScanner's own JobCardPriority enum names so it can be posted to POST /api/jobcards
    /// unchanged.</summary>
    [Required, MaxLength(30)]
    public string PriorityLabel { get; set; } = default!;

    /// <summary>Controls display order within each dropdown level (Job Types among themselves,
    /// Service Heads within a Job Type, Priorities within a Job Type + Service Head). Rows with
    /// the same SortOrder fall back to alphabetical.</summary>
    public int SortOrder { get; set; } = 0;

    public bool IsActive { get; set; } = true;

    public Guid? CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid? UpdatedById { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
