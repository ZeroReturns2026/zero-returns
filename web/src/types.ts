export interface Merchant {
  id: number;
  shop_domain: string;
  display_name: string;
  created_at: Date;
}

export interface Product {
  id: number;
  merchant_id: number;
  shopify_product_id: string;
  handle: string;
  title: string;
  category: string; // 'mens_top' for v1
  created_at: Date;
}

export interface ProductSize {
  id: number;
  product_id: number;
  size_label: string; // S, M, L, XL
  chest_inches: number;
  shoulder_inches: number;
  length_inches: number;
}

export interface ExternalReferenceItem {
  id: number;
  brand: string;
  product_name: string;
  item_type: string; // 'tshirt', 'polo', 'button_down', 'oxford', etc.
  size_label: string;
  chest_inches: number;
  // shoulder/length can be NULL — many brands publish chest only.
  // The recommendation engine handles null safely (skips that component).
  shoulder_inches: number | null;
  length_inches: number | null;
  source?: string; // 'factory' | 'hand' (added in migration 007)
}

export interface FitProfile {
  id: number;
  anon_id: string | null;
  preferred_fit: 'trim' | 'standard' | 'relaxed' | null;
  created_at: Date;
}

export type EventType =
  | 'widget_open'
  | 'recommendation_requested'
  | 'recommendation_shown'
  | 'recommended_size_clicked'
  | 'add_to_cart_after_recommendation'
  | 'purchase_completed'
  | 'return_initiated';

export interface EventRow {
  id: number;
  merchant_id: number | null;
  product_id: number | null;
  event_type: EventType;
  payload: Record<string, any>;
  created_at: Date;
}

export interface RecommendationRequest {
  shopDomain: string;
  shopifyProductId: string;
  referenceItemId: number;
  fitPreference?: 'trim' | 'standard' | 'relaxed';
}

export interface RecommendationResponse {
  recommendedSize: string;
  confidence: number; // 0-100
  fitNote: string;
  source?: string;   // 'measurement' | 'collaborative' | 'collaborative+measurement' | 'measurement+collab-note'
  scoredSizes: Array<{
    size: string;
    score: number;
  }>;
}
