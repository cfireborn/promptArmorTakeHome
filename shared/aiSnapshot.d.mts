export type AISnapshotInput = {
  submissionId: string;
  versionId: number;
  content: {
    headline: string; body: string; disclosure: string; cta: string;
    art: string; image?: string; palette?: string;
  };
  scope: {
    product: string; audience: string; channel: string; placement: string;
    jurisdiction?: string; affiliatePartner?: string;
  };
};
export function sourceFingerprint(input: AISnapshotInput): string;
