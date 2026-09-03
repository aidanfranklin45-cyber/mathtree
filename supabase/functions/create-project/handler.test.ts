import { assertEquals, assert } from "std/testing/asserts.ts";
import { handleRequest } from "./index.ts";

Deno.test("create-project - CORS OPTIONS Preflight", async () => {
  const req = new Request("https://localhost/functions/v1/create-project", {
    method: "OPTIONS"
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert(res.headers.get("Access-Control-Allow-Methods")?.includes("POST"));
  assert(res.headers.get("Access-Control-Allow-Headers")?.includes("authorization"));
});

Deno.test("create-project - Malformed JSON body", async () => {
  const req = new Request("https://localhost/functions/v1/create-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "invalid-json{"
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const data = await res.json();
  assertEquals(data.error, "Invalid JSON request body");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("create-project - Missing or zero purchase price", async () => {
  const req = new Request("https://localhost/functions/v1/create-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Test Project",
      assetType: "single-family",
      inputs: { purchasePrice: 0 }
    })
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 400);
  const data = await res.json();
  assert(data.error.includes("purchasePrice"));
});

Deno.test("create-project - Guided Wizard Payload (Client Alignment)", async () => {
  const wizardPayload = {
    name: "Oakridge 12-Plex Multi-Family",
    asset_class: "multi-unit",
    location: "Atlanta, GA",
    inputs: {
      purchasePrice: 1850000,
      downPaymentPercent: 25,
      closingCosts: 37000,
      rehabBudget: 75000,
      grossRentPerMonth: 18000,
      otherIncome: 800,
      vacancyRate: 6.0,
      annualRentGrowth: 3.5,
      operatingExpenseRatio: 40.0,
      expenseGrowthRate: 2.5,
      interestRate: 6.25,
      amortizationYears: 30,
      loanTermYears: 30,
      targetExitCapRate: 6.5,
      appreciationRate: 4.0,
      numUnits: 12
    }
  };

  const req = new Request("https://localhost/functions/v1/create-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wizardPayload)
  });

  const res = await handleRequest(req);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");

  const data = await res.json();
  assertEquals(data.success, true);

  // Verify project structure
  assert(data.project);
  assertEquals(data.project.title, "Oakridge 12-Plex Multi-Family");
  assertEquals(data.project.asset_type, "multi-unit");

  // Verify deal structure (frontend compatibility)
  assert(data.deal);
  assertEquals(data.deal.name, "Oakridge 12-Plex Multi-Family");
  assertEquals(data.deal.asset_class, "multi-unit");
  assertEquals(data.deal.location, "Atlanta, GA");
  assertEquals(data.deal.purchase_price, 1850000);
  assert(data.deal.irr > 0);
  assert(data.deal.equity_multiple > 1);

  // Verify pitch deck structure
  assert(data.pitchDeck);
  assertEquals(data.pitchDeck.title, "Oakridge 12-Plex Multi-Family");
  assertEquals(data.pitchDeck.assetType, "multi-unit");
  assert(Array.isArray(data.pitchDeck.highlights));
  assertEquals(data.pitchDeck.highlights.length, 4);
  assert(data.pitchDeck.summary.purchasePrice === 1850000);
  assert(data.pitchDeck.summary.year1Noi > 0);
  assert(data.pitchDeck.summary.year1CashFlow > 0);
  assert(Array.isArray(data.pitchDeck.risks));
  assertEquals(data.pitchDeck.projections.length, 10);
});
