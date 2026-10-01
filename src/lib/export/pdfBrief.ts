/** The briefs are React pages computed in the browser from the app's own data; there is no server round trip. */

/** Opens the deal brief in a new tab. */
export function openDealBrief(dealId: string): void {
  window.open(`/brief?id=${encodeURIComponent(dealId)}`, '_blank');
}

/** Opens the portfolio and pipeline brief in a new tab. */
export function openPortfolioBrief(): void {
  window.open('/portfolio-brief', '_blank');
}
