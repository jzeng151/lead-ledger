export type IcpConfig = {
  industries: string[];
  headcount: { min: number; max: number; sweet: [number, number] };
  fundingStages: string[];
  fundingRecencyMonths: number;
  competitors: string[];
  buyerTitles: string[];
  disqualifiers: string[];
  weights: { firmographic: number; role: number; technographic: number };
  engagementDecayPerMonth: number;
  reviewBand: [number, number];
  // priority = fit + urgency.liftMax * urgency, where urgency blends signed
  // timing (news triggers) with first-party intent (engagement). `floor` bounds
  // how far a negative trigger can pull priority below the fit baseline. Trigger
  // `weights` are per event type and may be negative (e.g. layoffs); `default`
  // covers unclassified events, `staleFactor` scales non-fresh events.
  urgency: {
    liftMax: number;
    floor: number;
    intentCoeff: number;
    staleFactor: number;
    weights: Record<string, number>;
  };
  // Letter-grade cutoffs on the 0-100 fit subscore (US academic scale; below D is F).
  grades: { A: number; B: number; C: number; D: number };
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
  engagementDecayPerMonth: 0.15,
  reviewBand: [45, 65],
  urgency: {
    liftMax: 20,
    floor: -0.5,
    intentCoeff: 0.6,
    staleFactor: 0.4,
    weights: {
      funding: 0.8,
      exec_hire: 0.7,
      incident: 0.6,
      product_launch: 0.4,
      expansion: 0.4,
      mna: 0.0,
      layoffs: -0.3,
      down_round: -0.4,
      default: 0.3,
    },
  },
  grades: { A: 90, B: 80, C: 70, D: 60 },
};
