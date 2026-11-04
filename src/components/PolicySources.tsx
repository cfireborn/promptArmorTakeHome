import type { PolicySource } from '../../shared/reviewPolicy.mjs';

const authorityLabels: Record<PolicySource['authority'], string> = {
  'company-policy': 'Company policy',
  federal: 'Federal source',
  state: 'State regulation',
  'partner-policy': 'Partner policy',
};

export function PolicySources({ sources }: { sources: readonly PolicySource[] }) {
  return (
    <ul className="policy-sources" aria-label="Policy sources">
      {sources.map(source => {
        const external = source.url.startsWith('https://');
        return (
          <li key={source.id}>
            <a
              href={source.url}
              {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
            >
              {source.label}
              {external && <span className="sr-only"> (opens in a new tab)</span>}
            </a>
            <small>{authorityLabels[source.authority]} · {source.pinpoint}</small>
          </li>
        );
      })}
    </ul>
  );
}
