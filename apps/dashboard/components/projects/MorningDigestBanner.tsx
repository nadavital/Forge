import type { MorningDigest } from "@/types/forge";

export function MorningDigestBanner({ digest }: { digest: MorningDigest }) {
  return (
    <section className="digest-banner">
      <p className="digest-kicker">What changed</p>
      <p className="digest-summary">{digest.summary}</p>
      {digest.topRecommendation ? (
        <p className="digest-recommendation">
          Recommended next: <span>{digest.topRecommendation}</span>
        </p>
      ) : null}
      {digest.changes.length > 0 ? (
        <ul className="digest-changes">
          {digest.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
