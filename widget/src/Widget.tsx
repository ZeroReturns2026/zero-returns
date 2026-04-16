import { useState } from 'react';
import { Modal } from './Modal';
import { postEvent } from './api';

export interface WidgetProps {
  shopDomain: string;
  shopifyProductId: string;
  productTitle: string;
  proxyBase: string;
}

export function Widget(props: WidgetProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    setOpen(true);
    postEvent(props.proxyBase, {
      shopDomain: props.shopDomain,
      shopifyProductId: props.shopifyProductId,
      eventType: 'widget_open',
    });
  };

  return (
    <>
      <div className="ht-card">
        <div className="ht-card-body">
          <h3 className="ht-title">Find My Best Size</h3>
          <p className="ht-subtext">
            Use one item you already own to get a fast recommendation
          </p>
          <button type="button" className="ht-cta" onClick={handleOpen}>
            Find My Size
          </button>
        </div>
      </div>

      {open && <Modal {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
