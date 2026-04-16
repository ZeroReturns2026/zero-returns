import { createRoot } from 'react-dom/client';
import { Widget } from './Widget';
import './styles.css';

function boot() {
  const el = document.getElementById('hey-tailor-root');
  if (!el) return;

  const shopDomain = el.dataset.shop ?? '';
  const shopifyProductId = el.dataset.productId ?? '';
  const productTitle = el.dataset.productTitle ?? 'this item';
  const proxyBase = el.dataset.proxyBase ?? '/apps/hey-tailor';

  createRoot(el).render(
    <Widget
      shopDomain={shopDomain}
      shopifyProductId={shopifyProductId}
      productTitle={productTitle}
      proxyBase={proxyBase}
    />
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
