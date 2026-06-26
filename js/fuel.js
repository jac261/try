/* Try — fuel planner domain logic (pure, no UI).
   Turns race duration + body weight + carb target into a personalised dual-carb
   (1:0.8 maltodextrin:fructose) mix, plus a cost comparison vs commercial gels. */
(function () {
  const F = (window.TFUEL = {});

  // 1:0.8 maltodextrin:fructose — the multiple-transportable-carb ratio that lets
  // the gut absorb up to ~90–120 g/h instead of ~60 g/h from a single sugar.
  F.RATIO = { malto: 1, fruc: 0.8 };

  // Wholesale ingredient pricing (£/kg, 25 kg bags) + commercial benchmark.
  F.PRICE = { malto: 1.40, fruc: 2.56, addPerKg: 9.0, addPct: 0.05, commercialServing: 2.75 };
  F.SERVING_G = 90; // grams of carb in one commercial serving (Styrkr/SiS/Maurten)

  // Typical age-grouper finish times (hours) to pre-fill the duration.
  F.RACE_HOURS = { sprint: 1.5, olympic: 3.0, half: 6.0, full: 13.0 };

  // Carb target (g/h) scales with how long you're out there — gut-limited, not weight-scaled.
  F.targetCarbs = function (hours) {
    if (hours < 1) return 30;
    if (hours < 2.5) return 60;
    if (hours < 4) return 85;
    return 100;
  };

  F.clampCarbs = function (g) { return Math.max(20, Math.min(120, Math.round(g / 5) * 5)); };

  // Build the full fuel plan.
  F.plan = function (opts) {
    const hours = Math.max(0.25, opts.hours || 1);
    const gPerHour = opts.gPerHour || F.targetCarbs(hours);
    const weightKg = opts.weightKg || 70;

    const totalCarb = gPerHour * hours;
    const cf = F.RATIO.malto + F.RATIO.fruc;
    const malto = totalCarb * F.RATIO.malto / cf;
    const fruc = totalCarb * F.RATIO.fruc / cf;
    // electrolyte/flavour additives ~5% of finished blend mass
    const additives = (malto + fruc) * F.PRICE.addPct / (1 - F.PRICE.addPct);

    const cost =
      (malto / 1000) * F.PRICE.malto +
      (fruc / 1000) * F.PRICE.fruc +
      (additives / 1000) * F.PRICE.addPerKg;
    const commCost = (totalCarb / F.SERVING_G) * F.PRICE.commercialServing;

    // hydration & sodium are the weight-scaled bits (rough, well-supported ranges).
    const fluid = Math.round(Math.min(800, Math.max(400, weightKg * 8)));   // ml/h
    const sodium = Math.round(Math.min(800, Math.max(300, weightKg * 7)));  // mg/h

    return {
      hours: hours, gPerHour: gPerHour, weightKg: weightKg,
      totalCarb: Math.round(totalCarb),
      malto: Math.round(malto), fruc: Math.round(fruc),
      additives: Math.round(additives),
      totalPowder: Math.round(malto + fruc + additives),
      cost: cost, commCost: commCost,
      saving: commCost - cost, savingPct: commCost ? 1 - cost / commCost : 0,
      fluid: fluid, sodium: sodium,
    };
  };

  F.fmtMoney = function (n) { return '£' + n.toFixed(2); };
})();
