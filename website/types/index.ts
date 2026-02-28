/**
 * Shared TypeScript types for InventionGenie
 */

// Row from the patents table (read-only — never UPDATE or DELETE)
export interface Patent {
  patent_number: string
  application_number: string | null
  patent_type: string | null
  filing_date: string | null
  grant_date: string | null
  issue_date: string | null
  title: string
  assignee_name: string | null
  inventor_names: string | null  // JSON array
  cpc_section: string | null
  tech_category: string | null
  has_benefit: number | null
  pta_days: number | null
  pte_154_days: number | null
  pte_156_days: number | null
  td_exists: number | null
  mf_status: string | null
  mf_lapse_date: string | null
  calculated_expiration_date: string | null
  expiration_reason: string | null
  status: string
  enriched: number
}

// Row from patent_scores table
export interface PatentScore {
  id: number
  patent_number: string
  score: number
  consumer_relevance: number | null
  relatability: number | null
  explainability: number | null
  visual_appeal: number | null
  abstract: string | null
  plain_english: string | null
  has_diagrams: number
  scored_at: string
  approved_for_content: number
  approved_at: string | null
}

// patent_scores joined with patents — used in admin Patent Review tab
export interface ScoredPatent extends PatentScore {
  title: string
  assignee_name: string | null
  cpc_section: string | null
  calculated_expiration_date: string | null
  filing_date: string | null
  grant_date: string | null
}

// Row from content_queue table
export interface ContentQueueItem {
  id: number
  patent_number: string
  score: number
  research_summary: string | null
  research_insights: string | null
  diagram_urls: string | null  // JSON array: ["url1","url2","url3"]
  caption_twitter: string | null
  caption_fbli: string | null
  web_summary: string | null
  web_insights: string | null
  image_overlay_text: string | null
  social_image_url: string | null
  url_slug: string
  url_full: string
  scrape_status: 'pending' | 'scraped' | 'failed' | 'blocked'
  scrape_attempts: number
  scrape_error: string | null
  status: 'pending' | 'approved' | 'published' | 'rejected'
  created_at: string
  approved_at: string | null
  published_at: string | null
}

// content_queue joined with patents — used in admin Content Review tab
export interface ContentQueueItemWithPatent extends ContentQueueItem {
  title: string
  assignee_name: string | null
  calculated_expiration_date: string | null
  filing_date: string | null
  grant_date: string | null
}

// Row from published_content table
export interface PublishedContent {
  id: number
  patent_number: string
  url_slug: string
  posted_twitter: number
  posted_facebook: number
  posted_linkedin: number
  posted_at: string | null
  post_notes: string | null
  twitter_likes: number
  twitter_retweets: number
  facebook_likes: number
  facebook_shares: number
  linkedin_likes: number
  linkedin_shares: number
  website_clicks: number
  published_at: string
}

// Row from prompts table
export interface Prompt {
  id: number
  prompt_type: 'scoring' | 'content_generation'
  prompt_text: string
  version: number
  is_active: number
  created_at: string
  notes: string | null
}

// Claude Haiku scoring response (parsed from JSON)
export interface ScoringResult {
  plain_english: string
  consumer_relevance: number
  relatability: number
  explainability: number
  visual_appeal: number
  score: number
  reasoning: string
}

// Claude Sonnet content generation response (parsed from JSON)
export interface ContentGenerationResult {
  caption_twitter: string
  caption_fbli: string
  web_summary: string
  web_insights: string
  image_overlay_text: string
}
