import { MODELS, EFFORT } from "../models";
import { SYSTEM_PROMPTS } from "./prompts";
import * as S from "./schemas";

export const FANOUT = [
  { key: "company",    system: SYSTEM_PROMPTS.company,    schema: S.CompanyFindings },
  { key: "contact",    system: SYSTEM_PROMPTS.contact,    schema: S.ContactFindings },
  { key: "tech",       system: SYSTEM_PROMPTS.tech,       schema: S.TechFindings },
  { key: "news",       system: SYSTEM_PROMPTS.news,       schema: S.NewsFindings },
  { key: "engagement", system: SYSTEM_PROMPTS.engagement, schema: S.EngagementFindings },
] as const;
export const VERIFICATION = { key: "verification", system: SYSTEM_PROMPTS.verification, schema: S.VerificationFindings };
export const ICPFIT = { key: "icpfit", system: SYSTEM_PROMPTS.icpfit, schema: S.IcpFitFindings };
export { MODELS, EFFORT, SYSTEM_PROMPTS };
