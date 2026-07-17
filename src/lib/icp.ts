export type IcpConfig = {
  industries: string[];
  headcount: { min: number; max: number; sweet: [number, number] };
  fundingStages: string[];
  fundingRecencyMonths: number;
  competitors: string[];
  buyerTitles: string[];
  disqualifiers: string[];
  weights: { firmographic: number; role: number; technographic: number };
  blend: { fit: number; engagement: number };
  engagementDecayPerMonth: number;
  reviewBand: [number, number];
};

export const DEFAULT_ICP: IcpConfig = {
  industries: ["software", "saas", "internet", "ai"],
  headcount: { min: 20, max: 300, sweet: [30, 150] },
  fundingStages: ["seed", "series_a", "series_b"],
  fundingRecencyMonths: 12,
  competitors: ["Datadog", "New Relic"],
  buyerTitles: ["CTO", "VP Engineering", "Head of Platform", "SRE", "DevOps", "Staff Engineer"],
  disqualifiers: ["no engineering org", "pre-product under 15", "1000+ enterprise incumbent", "offline business"],
  weights: { firmographic: 0.4, role: 0.3, technographic: 0.3 },
  blend: { fit: 0.6, engagement: 0.4 },
  engagementDecayPerMonth: 0.15,
  reviewBand: [45, 65],
};
