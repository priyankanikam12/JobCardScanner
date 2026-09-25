/**
 * Hardcoded Job Type / Service Head / Service Type / Job Source / Complaint (Customer Voice)
 * catalog for the Job Card Wizard - 2026-09-25 ("Job Type * hardcoded in dropdown ... Service
 * Head *, Service Type * ... all harcoded with dependancy like previous").
 *
 * 2026-09-25 UPDATE: JOB_TYPES and SERVICE_HEADS were REPLACED per your explicit instruction
 * ("Job Type * in that 1. Accidental 2. Major 3. Minor 4. Running repair ... Service Head * in
 * that for 1. Accidental dependancy wants Accidental direct select in Service Head bi defualt
 * Accidental dont give option Select Service head"). This is data YOU specified directly, not
 * something inferred/invented - the four Job Types and the six Service Heads below (Accidental;
 * M1/M2 under Major; D1/D2 under Minor; Running Repair under Running repair) are exactly what you
 * gave, including the placeholder-looking "M1"/"M2"/"D1"/"D2" names. If those are meant to be
 * fuller names, send them and I'll swap them in - nothing else needs to change.
 *
 * SERVICE_TYPES below is UNCHANGED from the original real `select * from ServiceType` data (still
 * real business data, not invented) but is now ORPHANED from the new SERVICE_HEADS ids above (its
 * serviceHeadId values point at the OLD Service Head list, which no longer exists) - this is fine
 * because the Service Type picker is no longer shown in the wizard at all (hidden per your
 * "according screenshot only those feilds show on page" instruction), so nothing reads
 * serviceTypesForServiceHead's result any more. Left in place rather than deleted or guessed at,
 * in case Service Type ever needs to come back - I have no real Service Type data for the new
 * Major/Minor/Running Repair heads, so I did not invent any.
 *
 * JOB_SOURCES and COMPLAINTS are UNCHANGED - still transcribed verbatim from the live
 * `select * from JobSource` / `ComplaintMaster` result sets you pasted on 2026-09-25.
 *
 * EXCLUDED AS JUNK/TEST DATA - my own editorial judgement, NOT confirmed by you:
 *   - JobSource id=6 "Ad.test" (created 2026-06-22 by test account 973620f2-...).
 * (ServiceHead id=15 "test" no longer applies - the whole old ServiceHead list was replaced above.)
 * If it should actually be selectable, add it back into JOB_SOURCES below.
 *
 * NOT wired up: ComplaintMaster's GroupName column (17/16/19/20 in your paste) looks like it MIGHT
 * link a complaint to a specific Job Type/Service Head/Service Type, but that linkage was never
 * confirmed, so complaints are NOT filtered by the Job Type/Service Head picked above - every
 * complaint in COMPLAINTS is always selectable. GroupName is kept on each row as `groupCode` in
 * case this needs to be wired up later, but nothing reads it today.
 */

export interface ServiceCatalogJobType {
  id: number
  name: string
}

export interface ServiceCatalogServiceHead {
  id: number
  jobTypeId: number
  name: string
}

export interface ServiceCatalogServiceType {
  id: number
  serviceHeadId: number
  name: string
}

export interface ServiceCatalogJobSource {
  id: number
  name: string
}

export interface ServiceCatalogComplaint {
  id: number
  name: string
  /** DMS ComplaintMaster.GroupName - not currently used for filtering, see file doc comment. */
  groupCode: number
}

export const JOB_TYPES: ServiceCatalogJobType[] = [
  { id: 1, name: 'Accidental' },
  { id: 2, name: 'Major' },
  { id: 3, name: 'Minor' },
  { id: 4, name: 'Running Repair' },
]

export const SERVICE_HEADS: ServiceCatalogServiceHead[] = [
  { id: 1, jobTypeId: 1, name: 'Accidental' },
  { id: 2, jobTypeId: 2, name: 'M1' },
  { id: 3, jobTypeId: 2, name: 'M2' },
  { id: 4, jobTypeId: 3, name: 'D1' },
  { id: 5, jobTypeId: 3, name: 'D2' },
  { id: 6, jobTypeId: 4, name: 'Running Repair' },
]

export const SERVICE_TYPES: ServiceCatalogServiceType[] = [
  { id: 1, serviceHeadId: 1, name: 'PDI' },
  { id: 3, serviceHeadId: 3, name: '1st Free Service' },
  { id: 4, serviceHeadId: 4, name: '2nd Regular Service' },
  { id: 5, serviceHeadId: 4, name: '3rd Regular Service' },
  { id: 6, serviceHeadId: 3, name: '4th Free Service' },
  { id: 7, serviceHeadId: 4, name: '5th Regular Service' },
  { id: 8, serviceHeadId: 4, name: '6th Regular Service' },
  { id: 9, serviceHeadId: 5, name: 'Paid Service' },
  { id: 10, serviceHeadId: 6, name: 'Ignition Lock Repair / Replacement' },
  { id: 11, serviceHeadId: 6, name: 'Wiring harness Replacement' },
  { id: 12, serviceHeadId: 6, name: 'Front/Rear suspension Replacement' },
  { id: 13, serviceHeadId: 6, name: 'Handler Bar Replacement' },
  { id: 14, serviceHeadId: 6, name: 'Chassis Replacement' },
  { id: 15, serviceHeadId: 6, name: 'Aux Battery Replacement' },
  { id: 16, serviceHeadId: 6, name: 'DC-DC Replacement' },
  { id: 17, serviceHeadId: 6, name: 'VCU Replacement' },
  { id: 18, serviceHeadId: 6, name: 'Throttle Replacement' },
  { id: 19, serviceHeadId: 6, name: 'Instrument Cluster Replacement' },
  { id: 20, serviceHeadId: 6, name: 'Controller Replacement' },
  { id: 21, serviceHeadId: 6, name: 'Charger Repair /Replacement' },
  { id: 22, serviceHeadId: 6, name: 'Motor Repair /Replacement' },
  { id: 23, serviceHeadId: 6, name: 'Battery Repair /Replacement' },
  { id: 24, serviceHeadId: 6, name: 'General Check-up/Issue' },
  { id: 25, serviceHeadId: 6, name: 'PP Parts' },
  { id: 26, serviceHeadId: 6, name: 'Electrical Accessories' },
  { id: 27, serviceHeadId: 6, name: 'Mega Camp' },
  { id: 28, serviceHeadId: 6, name: 'Sofware Issue' },
  { id: 29, serviceHeadId: 6, name: 'All Type Loose Connection Check up' },
  { id: 30, serviceHeadId: 6, name: 'Side / Main Stand' },
  { id: 31, serviceHeadId: 6, name: 'Ignition Switch assembly General Complain' },
  { id: 32, serviceHeadId: 6, name: 'Front / Rear Tyre' },
  { id: 33, serviceHeadId: 6, name: 'Front /RearBrake Assembly general Complain' },
  { id: 34, serviceHeadId: 6, name: 'Charger General Enquiry' },
  { id: 35, serviceHeadId: 6, name: 'Motor General Enquiry' },
  { id: 36, serviceHeadId: 6, name: 'Battery General Enquiry' },
  { id: 37, serviceHeadId: 7, name: 'Regular Service' },
  { id: 38, serviceHeadId: 8, name: 'General Check-up/Issue' },
  { id: 39, serviceHeadId: 8, name: 'Sofware Issue' },
  { id: 40, serviceHeadId: 8, name: 'Ignition Switch assembly General Complain' },
  { id: 41, serviceHeadId: 8, name: 'Front / Rear Tyre' },
  { id: 42, serviceHeadId: 8, name: 'Wiring harness Replacement' },
  { id: 43, serviceHeadId: 8, name: 'Front/Rear suspension Replacement' },
  { id: 44, serviceHeadId: 8, name: 'VCU Replacement' },
  { id: 45, serviceHeadId: 8, name: 'Throttle Replacement' },
  { id: 51, serviceHeadId: 2, name: 'Accidental' },
]

export const JOB_SOURCES: ServiceCatalogJobSource[] = [
  { id: 1, name: 'Walk In' },
  { id: 2, name: 'RSA' },
  { id: 3, name: 'Mega Camp' },
  { id: 5, name: 'Others' },
]

export const COMPLAINTS: ServiceCatalogComplaint[] = [
  { id: 4, name: 'Service 1 st', groupCode: 17 },
  { id: 5, name: 'Service 2nd', groupCode: 17 },
  { id: 6, name: 'Motor Not Working', groupCode: 16 },
  { id: 7, name: 'Motor Out', groupCode: 16 },
  { id: 8, name: 'PDI 1', groupCode: 19 },
  { id: 9, name: 'PDI 2', groupCode: 19 },
  { id: 10, name: 'PDI 3', groupCode: 19 },
  { id: 11, name: 'Fame II Subsidy', groupCode: 20 },
]

/** Service Heads under a given Job Type id - null/undefined returns none, same as the old
 * "Select a job type first" disabled-dropdown state. */
export function serviceHeadsForJobType(jobTypeId: number | null | undefined): ServiceCatalogServiceHead[] {
  if (jobTypeId == null) return []
  return SERVICE_HEADS.filter((h) => h.jobTypeId === jobTypeId)
}

/** Service Types under a given Service Head id - null/undefined returns none, same as the old
 * "Select a service head first" disabled-dropdown state. */
export function serviceTypesForServiceHead(serviceHeadId: number | null | undefined): ServiceCatalogServiceType[] {
  if (serviceHeadId == null) return []
  return SERVICE_TYPES.filter((t) => t.serviceHeadId === serviceHeadId)
}
