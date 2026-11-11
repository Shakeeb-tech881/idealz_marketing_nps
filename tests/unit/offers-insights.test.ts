import { describe, expect, test } from "vitest";
import { offerBodyProblems, offerOptoutUrl, redactOptoutLink, renderOffer, worstCaseSegments } from "@/lib/offers/template";
import { describeInsightFilters, insightFiltersToParams, insightRpcArgs, lastPurchaseBefore, parseInsightFilters } from "@/lib/insights/filters";

describe("offer messages", () => {
  test("every offer needs the stop link and only known variables", () => {
    expect(offerBodyProblems("New iPhone in stock!")).toEqual([expect.stringMatching(/optout_link/)]);
    expect(offerBodyProblems("Hi {{name}} {{optout_link}}")[0]).toMatch(/Unknown variable: \{\{name\}\}/);
    expect(offerBodyProblems("Hi {{customer_name}}, upgrade your {{last_model}}. Stop: {{optout_link}}")).toEqual([]);
    expect(offerBodyProblems("")).toContain("Write the message.");
  });

  test("renders per customer and keeps the secret link out of logs", () => {
    const link = offerOptoutUrl("https://cx.idealz.lk/", "AbCdEfGhIjKlMnOpQrStUv");
    expect(link).toBe("https://cx.idealz.lk/u/AbCdEfGhIjKlMnOpQrStUv");
    const msg = renderOffer("Hi {{customer_name}}, upgrade your {{last_model}} at {{brand_name}}! Stop: {{optout_link}}", {
      customerName: "Mohamed Irshad", lastModel: "iPhone 13", brandName: "iSeven Mobiles", optoutLink: link,
    });
    expect(msg).toBe("Hi Mohamed, upgrade your iPhone 13 at iSeven Mobiles! Stop: https://cx.idealz.lk/u/AbCdEfGhIjKlMnOpQrStUv");
    expect(redactOptoutLink(msg, link)).not.toContain("AbCdEf");
    expect(renderOffer("Your {{last_model}} {{optout_link}}", { customerName: "A", optoutLink: "x" })).toBe("Your your phone x");
  });

  test("cost estimate uses the longest name and model", () => {
    const s = worstCaseSegments("Hi {{customer_name}}, upgrade your {{last_model}}! {{optout_link}}", {
      names: ["Ann", "Mohamedirshadfarook Perera"], models: ["iPhone 13", "Galaxy S24 Ultra 512GB"], branches: [], brands: [],
    }, "https://idealzmarketingnps.vercel.app");
    expect(s.text).toContain("Mohamedirshadfarook");
    expect(s.text).toContain("Galaxy S24 Ultra 512GB");
    expect(s.segments).toBe(1);
    expect(worstCaseSegments("Hi {{customer_name}} ’ {{optout_link}}", { names: ["A"], models: [], branches: [], brands: [] }, "https://x.lk").encoding).toBe("UCS-2");
  });
});

describe("customer insight filters", () => {
  test("only valid values are accepted", () => {
    const f = parseInsightFilters({ brand: "nokia", nps: "great", offers: "allowed", age: "12", branch: "not-a-uuid", from: "2026-01-01", to: "bad", model: "  iPhone 15  " });
    expect(f).toMatchObject({ brand: null, nps: null, offers: "allowed", ageMonths: 12, branch: null, from: "2026-01-01", to: null, model: "iPhone 15" });
    expect(parseInsightFilters({ age: "7" }).ageMonths).toBeNull();
  });

  test("round-trips through the URL and builds database arguments", () => {
    const f = parseInsightFilters({ model: "iPhone 15", brand: "apple", age: "12", nps: "detractor" });
    expect(parseInsightFilters(Object.fromEntries(insightFiltersToParams(f)))).toEqual(f);
    const now = new Date("2026-11-11T06:00:00Z");
    expect(lastPurchaseBefore(12, now)).toBe("2025-11-11");
    expect(insightRpcArgs(f, 50, 100, now)).toMatchObject({ p_model: "iPhone 15", p_brand: "apple", p_last_purchase_before: "2025-11-11", p_nps: "detractor", p_limit: 50, p_offset: 100 });
    expect(describeInsightFilters(f)).toBe("bought “iPhone 15” · bought Apple · last purchase over 12 months ago · latest feedback: detractor");
    expect(describeInsightFilters(parseInsightFilters({}))).toBe("all customers");
  });
});
