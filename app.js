// ============================================================================
// 相続・生前贈与 4パターン比較シミュレーター (v4) - JavaScript計算エンジン & UI
// ============================================================================

const DEFAULTS = {
  husband_asset: 580000000,
  husband_land_value: 100000000,
  wife_asset: 20000000,
  wife_land_value: 0,
  land_area_sqm: 400,
  husband_life: 7,
  wife_life: 11,
  num_children: 2,
  living_cost_couple: 3450000,
  living_cost_single: 1950000,
  return_rate_pct: 1.0,
  apply_kakuchi_1st: true,
  apply_kakuchi_2nd: true,
  kakuchi_limit_sqm: 330,
  seisan_annual_gift: 1100000
};

const HYBRID_PRESET = {
  husband_asset: 500000000,
  husband_land_value: 100000000,
  wife_asset: 120000000,
  wife_land_value: 0,
  land_area_sqm: 400,
  husband_life: 5,
  wife_life: 18,
  num_children: 2,
  living_cost_couple: 3450000,
  living_cost_single: 1950000,
  return_rate_pct: 2.0,
  apply_kakuchi_1st: true,
  apply_kakuchi_2nd: true,
  kakuchi_limit_sqm: 330,
  seisan_annual_gift: 1100000
};

// ----------------------------------------------------------------------------
// 1. 税金計算ロジック
// ----------------------------------------------------------------------------
function calculateGiftTax(amount) {
  const taxable = amount - 1100000;
  if (taxable <= 0) return 0;
  if (taxable <= 2000000) return taxable * 0.10;
  if (taxable <= 4000000) return taxable * 0.15 - 100000;
  if (taxable <= 6000000) return taxable * 0.20 - 300000;
  if (taxable <= 10000000) return taxable * 0.30 - 900000;
  if (taxable <= 15000000) return taxable * 0.40 - 1900000;
  if (taxable <= 30000000) return taxable * 0.45 - 2650000;
  return taxable * 0.55 - 4000000;
}

function getGiftMarginalRate(amount) {
  const taxable = amount - 1100000;
  if (taxable <= 0) return 0.0;
  if (taxable <= 2000000) return 0.10;
  if (taxable <= 4000000) return 0.15;
  if (taxable <= 6000000) return 0.20;
  if (taxable <= 10000000) return 0.30;
  if (taxable <= 15000000) return 0.40;
  if (taxable <= 30000000) return 0.45;
  return 0.55;
}

function getInheritanceMarginalRate(netEstate, numHeirs) {
  const basicDeduction = 30000000 + 6000000 * numHeirs;
  const taxableEstate = netEstate - basicDeduction;
  if (taxableEstate <= 0) return 0.0;

  const perHeirShare = taxableEstate / numHeirs;
  if (perHeirShare <= 10000000) return 0.10;
  if (perHeirShare <= 30000000) return 0.15;
  if (perHeirShare <= 50000000) return 0.20;
  if (perHeirShare <= 100000000) return 0.30;
  if (perHeirShare <= 200000000) return 0.40;
  if (perHeirShare <= 300000000) return 0.45;
  if (perHeirShare <= 600000000) return 0.50;
  return 0.55;
}

function findDynamicOptimumGift(currentAsset, numHeirs, numChildren, maxGiftPerChild = 3000000) {
  const inhRate = getInheritanceMarginalRate(currentAsset, numHeirs);
  if (inhRate === 0) return 0;

  const maxTotalGift = numChildren * maxGiftPerChild;
  let bestGift = 1100000;

  for (let amt = 1200000; amt <= maxTotalGift; amt += 100000) {
    if (amt > currentAsset) break;
    if (amt > maxTotalGift) break;
    if (getGiftMarginalRate(amt) <= inhRate) {
      bestGift = amt;
    } else {
      break;
    }
  }
  return bestGift;
}

function calculate7YrAddbackAndCredit(giftHistory, numChildren) {
  const recent7 = giftHistory.slice(-7);
  let addToEstate = 0;
  let giftTaxCredit = 0;

  const reversed = [...recent7].reverse();
  const recent3 = reversed.slice(0, 3);
  for (const gAmt of recent3) {
    addToEstate += gAmt * numChildren;
    giftTaxCredit += calculateGiftTax(gAmt) * numChildren;
  }

  const old4Years = reversed.slice(3);
  if (old4Years.length > 0) {
    const totalOld4PerChild = old4Years.reduce((a, b) => a + b, 0);
    const totalOld4TaxPerChild = old4Years.reduce((a, b) => a + calculateGiftTax(b), 0);
    const addedOld4PerChild = Math.max(0, totalOld4PerChild - 1000000);
    addToEstate += addedOld4PerChild * numChildren;

    if (totalOld4PerChild > 0 && addedOld4PerChild > 0) {
      const creditRatio = addedOld4PerChild / totalOld4PerChild;
      giftTaxCredit += (totalOld4TaxPerChild * creditRatio) * numChildren;
    }
  }
  return { addToEstate, giftTaxCredit };
}

function calculateKakuchiReducedLandValue(landValue, landAreaSqm, applyFlag, limitSqm = 330) {
  if (landValue <= 0 || !applyFlag) return landValue;
  if (landAreaSqm <= 0) return landValue * 0.20;

  const applicableRatio = Math.min(1.0, limitSqm / landAreaSqm);
  const applicableValue = landValue * applicableRatio * 0.20;
  const excessValue = landValue * (1.0 - applicableRatio);
  return applicableValue + excessValue;
}

function calculateInheritanceTaxCore(netEstate, numHeirs, giftTaxCredit, actualSpouseRatio = 0.0) {
  const basicDeduction = 30000000 + 6000000 * numHeirs;
  const taxableEstate = netEstate - basicDeduction;
  if (taxableEstate <= 0) return { finalTax: 0, spouseActualHeritage: 0 };

  const perHeirShare = taxableEstate / numHeirs;
  let taxRate = 0.55;
  let deduction = 72000000;

  if (perHeirShare <= 10000000) { taxRate = 0.10; deduction = 0; }
  else if (perHeirShare <= 30000000) { taxRate = 0.15; deduction = 500000; }
  else if (perHeirShare <= 50000000) { taxRate = 0.20; deduction = 2000000; }
  else if (perHeirShare <= 100000000) { taxRate = 0.30; deduction = 7000000; }
  else if (perHeirShare <= 200000000) { taxRate = 0.40; deduction = 17000000; }
  else if (perHeirShare <= 300000000) { taxRate = 0.45; deduction = 27000000; }
  else if (perHeirShare <= 600000000) { taxRate = 0.50; deduction = 42000000; }

  const totalInheritanceTax = (perHeirShare * taxRate - deduction) * numHeirs;
  const spouseActualHeritage = netEstate * actualSpouseRatio;
  let finalTax = totalInheritanceTax;

  if (actualSpouseRatio > 0) {
    const legalSpouseLimit = netEstate * 0.5;
    const allowableLimit = Math.max(160000000, legalSpouseLimit);
    const spouseTaxReduction = spouseActualHeritage <= allowableLimit
      ? totalInheritanceTax * actualSpouseRatio
      : totalInheritanceTax * (allowableLimit / netEstate);
    finalTax = totalInheritanceTax - spouseTaxReduction;
  }

  finalTax = Math.max(0, finalTax - giftTaxCredit);
  return { finalTax, spouseActualHeritage };
}

// ----------------------------------------------------------------------------
// 2. シミュレーション実行エンジン
// ----------------------------------------------------------------------------
function simulateInheritanceTimeline(config, giftMode = "none", spouseSharePct = 50) {
  const husbandGiftMode = giftMode === "hybrid" ? "seisankaze" : giftMode;
  const wifeGiftMode = giftMode === "hybrid" ? "dynamic" : giftMode;

  let husbandAsset = config.husband_asset;
  let wifeAsset = config.wife_asset;
  let landValueH = config.husband_land_value;
  let landValueW = config.wife_land_value;
  const landArea = config.land_area_sqm;

  const yearsToFirst = config.husband_life;
  const yearsToSecond = config.wife_life;
  const numChildren = config.num_children;

  const husbandGiftHistory = [];
  const wifeGiftHistory = [];

  let seisanAddbackH = 0;
  let seisanAddbackW = 0;
  let seisanUsedSpecialDeductionH = 0;
  let seisanUsedSpecialDeductionW = 0;

  let childrenReceived = 0;
  let totalGiftTax = 0;
  const timelineHistory = [{
    year: 0,
    husband: husbandAsset + landValueH,
    wife: wifeAsset + landValueW,
    children: childrenReceived
  }];

  // フェーズ1: 現時点 〜 一次相続（夫死亡）
  for (let year = 1; year <= yearsToFirst; year++) {
    const currentTotalH = husbandAsset + landValueH;
    const inhRateH = getInheritanceMarginalRate(currentTotalH, numChildren + 1);

    let giftAmtH = 0;
    if (husbandGiftMode === "dynamic") {
      giftAmtH = findDynamicOptimumGift(currentTotalH, numChildren + 1, numChildren);
    } else if (husbandGiftMode === "seisankaze") {
      giftAmtH = inhRateH > 0 ? config.seisan_annual_gift : 0;
    }

    const totalGiftYearH = giftAmtH * numChildren;
    if (giftAmtH > 0 && husbandAsset >= totalGiftYearH) {
      husbandAsset -= totalGiftYearH;

      if (husbandGiftMode === "dynamic") {
        const taxH = calculateGiftTax(giftAmtH);
        childrenReceived += (giftAmtH - taxH) * numChildren;
        totalGiftTax += taxH * numChildren;
        husbandGiftHistory.push(giftAmtH);
      } else if (husbandGiftMode === "seisankaze") {
        const excessOver110 = Math.max(0, giftAmtH - 1100000);
        const remDeduction = Math.max(0, 25000000 - seisanUsedSpecialDeductionH);
        const usedNow = Math.min(excessOver110, remDeduction);
        seisanUsedSpecialDeductionH += usedNow;

        const taxableSeisan = Math.max(0, excessOver110 - usedNow);
        const taxH = taxableSeisan * 0.20;

        seisanAddbackH += excessOver110 * numChildren;
        childrenReceived += (giftAmtH - taxH) * numChildren;
        totalGiftTax += taxH * numChildren;
        husbandGiftHistory.push(giftAmtH);
      }
    } else {
      husbandGiftHistory.push(0);
    }

    let giftAmtWP1 = 0;
    if (giftMode === "hybrid" && wifeGiftMode === "dynamic") {
      const currentTotalWP1 = wifeAsset + landValueW;
      const inhRateWP1 = getInheritanceMarginalRate(currentTotalWP1, numChildren);
      if (inhRateWP1 > 0) {
        const candidateGiftW = findDynamicOptimumGift(currentTotalWP1, numChildren, numChildren);
        const safetyReserveW = config.living_cost_couple * 0.5 * (yearsToFirst - year + 1) + config.living_cost_single * 2;
        if (candidateGiftW > 0 && (wifeAsset - candidateGiftW * numChildren) >= safetyReserveW) {
          giftAmtWP1 = candidateGiftW;
          wifeAsset -= giftAmtWP1 * numChildren;
          const taxW = calculateGiftTax(giftAmtWP1);
          childrenReceived += (giftAmtWP1 - taxW) * numChildren;
          totalGiftTax += taxW * numChildren;
        }
      }
    }
    wifeGiftHistory.push(giftAmtWP1);

    husbandAsset = (husbandAsset - config.living_cost_couple / 2) * (1 + config.return_rate);
    wifeAsset = (wifeAsset - config.living_cost_couple / 2) * (1 + config.return_rate);
    childrenReceived = childrenReceived * (1 + config.return_rate);
    landValueH *= (1 + config.return_rate);
    landValueW *= (1 + config.return_rate);

    timelineHistory.push({
      year,
      husband: husbandAsset + landValueH,
      wife: wifeAsset + landValueW,
      children: childrenReceived
    });
  }

  // 一次相続（夫死亡）
  let addToEstateH = 0;
  let giftTaxCreditH = 0;
  if (husbandGiftMode === "dynamic") {
    const res = calculate7YrAddbackAndCredit(husbandGiftHistory, numChildren);
    addToEstateH = res.addToEstate;
    giftTaxCreditH = res.giftTaxCredit;
  } else if (husbandGiftMode === "seisankaze") {
    addToEstateH = seisanAddbackH;
    giftTaxCreditH = numChildren > 0 ? Math.max(0, (seisanAddbackH / numChildren - 25000000) * 0.20 * numChildren) : 0;
  }

  const appliedLandValue1st = calculateKakuchiReducedLandValue(
    landValueH, landArea, config.apply_kakuchi_1st, config.kakuchi_limit_sqm
  );

  const estateForTax1st = husbandAsset + appliedLandValue1st + addToEstateH;
  const divisibleEstate1st = husbandAsset + appliedLandValue1st;
  const targetWifeShareVal = divisibleEstate1st * (spouseSharePct / 100.0);

  const wifeLandRatio = appliedLandValue1st > 0 ? Math.min(1.0, targetWifeShareVal / appliedLandValue1st) : 0.0;
  const wifeAcquiredLandTaxVal = appliedLandValue1st * wifeLandRatio;
  const wifeAcquiredLandMarketVal = landValueH * wifeLandRatio;
  const childrenAcquiredLandMarketVal = landValueH * (1.0 - wifeLandRatio);

  const wifeAcquiredCashGross = Math.max(0.0, Math.min(husbandAsset, targetWifeShareVal - wifeAcquiredLandTaxVal));
  const childrenAcquiredCashGross = Math.max(0.0, husbandAsset - wifeAcquiredCashGross);

  const actualSpouseRatioForTax = estateForTax1st > 0
    ? (wifeAcquiredLandTaxVal + wifeAcquiredCashGross) / estateForTax1st
    : 0.0;

  const firstTax = calculateInheritanceTaxCore(
    estateForTax1st, numChildren + 1, giftTaxCreditH, actualSpouseRatioForTax
  ).finalTax;

  let wifeActualTax = 0.0;
  let childrenActualTax = firstTax;
  if (divisibleEstate1st > 0) {
    const totalTaxBeforeSpouse = calculateInheritanceTaxCore(
      estateForTax1st, numChildren + 1, giftTaxCreditH, 0.0
    ).finalTax;
    const spouseTaxGross = totalTaxBeforeSpouse * actualSpouseRatioForTax;
    const spouseTaxReduction = totalTaxBeforeSpouse - firstTax;
    wifeActualTax = Math.max(0.0, spouseTaxGross - spouseTaxReduction);
    childrenActualTax = Math.max(0.0, firstTax - wifeActualTax);
  }

  wifeAsset += Math.max(0.0, wifeAcquiredCashGross - wifeActualTax);
  landValueW += wifeAcquiredLandMarketVal;
  landValueH = 0;

  const childrenHeritage1st = Math.max(0.0, childrenAcquiredCashGross - childrenActualTax) + childrenAcquiredLandMarketVal;
  childrenReceived += childrenHeritage1st;
  husbandAsset = 0;

  timelineHistory[timelineHistory.length - 1] = {
    year: yearsToFirst,
    husband: 0,
    wife: wifeAsset + landValueW,
    children: childrenReceived
  };

  // フェーズ2: 一次相続後 〜 二次相続（妻死亡）
  for (let year = yearsToFirst + 1; year <= yearsToSecond; year++) {
    const currentTotalW = wifeAsset + landValueW;
    const inhRate = getInheritanceMarginalRate(currentTotalW, numChildren);

    let giftAmtW = 0;
    if (wifeGiftMode === "dynamic") {
      giftAmtW = findDynamicOptimumGift(currentTotalW, numChildren, numChildren);
    } else if (wifeGiftMode === "seisankaze") {
      giftAmtW = inhRate > 0 ? config.seisan_annual_gift : 0;
    }

    const totalGiftYearW = giftAmtW * numChildren;
    if (giftAmtW > 0 && wifeAsset >= totalGiftYearW) {
      wifeAsset -= totalGiftYearW;

      if (wifeGiftMode === "dynamic") {
        const taxW = calculateGiftTax(giftAmtW);
        childrenReceived += (giftAmtW - taxW) * numChildren;
        totalGiftTax += taxW * numChildren;
        wifeGiftHistory.push(giftAmtW);
      } else if (wifeGiftMode === "seisankaze") {
        const excessOver110 = Math.max(0, giftAmtW - 1100000);
        const remDeduction = Math.max(0, 25000000 - seisanUsedSpecialDeductionW);
        const usedNow = Math.min(excessOver110, remDeduction);
        seisanUsedSpecialDeductionW += usedNow;

        const taxableSeisan = Math.max(0, excessOver110 - usedNow);
        const taxW = taxableSeisan * 0.20;

        seisanAddbackW += excessOver110 * numChildren;
        childrenReceived += (giftAmtW - taxW) * numChildren;
        totalGiftTax += taxW * numChildren;
        wifeGiftHistory.push(giftAmtW);
      }
    } else {
      wifeGiftHistory.push(0);
    }

    wifeAsset = (wifeAsset - config.living_cost_single) * (1 + config.return_rate);
    childrenReceived = childrenReceived * (1 + config.return_rate);
    landValueW *= (1 + config.return_rate);

    timelineHistory.push({
      year,
      husband: 0,
      wife: wifeAsset + landValueW,
      children: childrenReceived
    });
  }

  // 二次相続（妻死亡）
  let addToEstateW = 0;
  let giftTaxCreditW = 0;
  if (wifeGiftMode === "dynamic") {
    const res = calculate7YrAddbackAndCredit(wifeGiftHistory, numChildren);
    addToEstateW = res.addToEstate;
    giftTaxCreditW = res.giftTaxCredit;
  } else if (wifeGiftMode === "seisankaze") {
    addToEstateW = seisanAddbackW;
    giftTaxCreditW = numChildren > 0 ? Math.max(0, (seisanAddbackW / numChildren - 25000000) * 0.20 * numChildren) : 0;
  }

  const appliedLandValue2nd = calculateKakuchiReducedLandValue(
    landValueW, landArea, config.apply_kakuchi_2nd, config.kakuchi_limit_sqm
  );

  const estateForTax2nd = wifeAsset + appliedLandValue2nd + addToEstateW;
  const secondTax = calculateInheritanceTaxCore(
    estateForTax2nd, numChildren, giftTaxCreditW, 0.0
  ).finalTax;

  const childrenHeritage2nd = Math.max(0, wifeAsset - secondTax) + landValueW;
  childrenReceived += childrenHeritage2nd;

  timelineHistory[timelineHistory.length - 1] = {
    year: yearsToSecond,
    husband: 0,
    wife: 0,
    children: childrenReceived
  };

  return {
    wealth: childrenReceived,
    giftTax: totalGiftTax,
    tax1: firstTax,
    tax2: secondTax,
    timeline: timelineHistory
  };
}

function findBestSpouseShareRatio(config, giftMode = "dynamic") {
  let bestRatio = 50;
  let maxWealth = -1;
  for (let ratio = 0; ratio <= 100; ratio++) {
    const res = simulateInheritanceTimeline(config, giftMode, ratio);
    if (res.wealth > maxWealth) {
      maxWealth = res.wealth;
      bestRatio = ratio;
    }
  }
  return bestRatio;
}

// ----------------------------------------------------------------------------
// 3. UI制御・グラフ描画（Canvas 2D）
// ----------------------------------------------------------------------------
function formatYen(num) {
  return Math.round(num).toLocaleString("ja-JP") + " 円";
}

function formatDiffYen(num) {
  const rounded = Math.round(num);
  const sign = rounded >= 0 ? "+" : "";
  return sign + rounded.toLocaleString("ja-JP") + " 円";
}

function formatOkuMan(yenVal) {
  const manVal = Math.round(yenVal / 10000);
  if (manVal === 0) return "0円";
  const oku = Math.floor(manVal / 10000);
  const rem = manVal % 10000;
  if (oku > 0 && rem > 0) return `${oku}億${rem.toLocaleString()}万円`;
  if (oku > 0) return `${oku}億円`;
  return `${rem.toLocaleString()}万円`;
}

function applyFormValues(values) {
  for (const [key, val] of Object.entries(values)) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(val);
    } else {
      el.value = val;
    }
  }
  const banner = document.getElementById("bannerBox");
  banner.classList.remove("highlight");
  banner.textContent = "上のフォームに条件を入力し、「シミュレーション実行」ボタンを押してください。";
  document.getElementById("resultSection").style.display = "none";
}

function collectConfig() {
  const getNum = (id) => Number(document.getElementById(id).value);
  const husbandLife = Math.trunc(getNum("husband_life"));
  const wifeLife = Math.trunc(getNum("wife_life"));
  const numChildren = Math.trunc(getNum("num_children"));

  if (husbandLife < 0 || wifeLife < husbandLife) {
    alert("二次相続までの年数は、一次相続までの年数以上の値を指定してください。");
    return null;
  }
  if (numChildren <= 0) {
    alert("子供の人数は1人以上を指定してください。");
    return null;
  }

  return {
    husband_asset: getNum("husband_asset"),
    husband_land_value: getNum("husband_land_value"),
    wife_asset: getNum("wife_asset"),
    wife_land_value: getNum("wife_land_value"),
    land_area_sqm: getNum("land_area_sqm"),
    husband_life: husbandLife,
    wife_life: wifeLife,
    num_children: numChildren,
    living_cost_couple: getNum("living_cost_couple"),
    living_cost_single: getNum("living_cost_single"),
    return_rate: getNum("return_rate_pct") / 100.0,
    apply_kakuchi_1st: document.getElementById("apply_kakuchi_1st").checked,
    apply_kakuchi_2nd: document.getElementById("apply_kakuchi_2nd").checked,
    kakuchi_limit_sqm: getNum("kakuchi_limit_sqm"),
    seisan_annual_gift: getNum("seisan_annual_gift")
  };
}

function drawTimelineChart(canvas, timeline, maxAsset) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padLeft = 72;
  const padRight = 20;
  const padTop = 26;
  const padBottom = 34;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  ctx.clearRect(0, 0, w, h);

  // グリッド＆Y軸目盛り
  const yMax = maxAsset > 0 ? maxAsset * 1.08 : 100000000;
  ctx.strokeStyle = "#e2e8f0";
  ctx.fillStyle = "#475569";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const val = (yMax / steps) * i;
    const y = padTop + plotH - (plotH * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.fillText(formatOkuMan(val), padLeft - 6, y);
  }

  // X軸目盛り
  const maxYear = timeline[timeline.length - 1].year || 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const d of timeline) {
    const x = padLeft + (plotW * d.year) / maxYear;
    if (maxYear <= 15 || d.year % 2 === 0 || d.year === maxYear) {
      ctx.fillText(`${d.year}年`, x, padTop + plotH + 6);
    }
  }

  const series = [
    { key: "husband", color: "#1f77b4", label: "夫" },
    { key: "wife", color: "#ff7f0e", label: "妻" },
    { key: "children", color: "#2ca02c", label: "子" }
  ];

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    timeline.forEach((d, idx) => {
      const x = padLeft + (plotW * d.year) / maxYear;
      const y = padTop + plotH - (plotH * d[s.key]) / yMax;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    timeline.forEach((d) => {
      const x = padLeft + (plotW * d.year) / maxYear;
      const y = padTop + plotH - (plotH * d[s.key]) / yMax;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 凡例 & 最終受取額ラベル
  let lx = padLeft;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 7, 12, 12);
    ctx.fillStyle = "#0f172a";
    ctx.fillText(s.label, lx + 16, 13);
    lx += 46;
  }

  const finalChild = timeline[timeline.length - 1].children;
  ctx.fillStyle = "#15803d";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`最終: ${formatOkuMan(finalChild)}`, w - padRight, 13);
}

function runSimulation() {
  const config = collectConfig();
  if (!config) return;

  const rNone = simulateInheritanceTimeline(config, "none", 50);
  const ratioDyn = findBestSpouseShareRatio(config, "dynamic");
  const rDyn = simulateInheritanceTimeline(config, "dynamic", ratioDyn);

  const ratioSei = findBestSpouseShareRatio(config, "seisankaze");
  const rSei = simulateInheritanceTimeline(config, "seisankaze", ratioSei);

  const ratioHyb = findBestSpouseShareRatio(config, "hybrid");
  const rHyb = simulateInheritanceTimeline(config, "hybrid", ratioHyb);

  const totNone = rNone.tax1 + rNone.tax2;
  const totDyn = rDyn.giftTax + rDyn.tax1 + rDyn.tax2;
  const totSei = rSei.giftTax + rSei.tax1 + rSei.tax2;
  const totHyb = rHyb.giftTax + rHyb.tax1 + rHyb.tax2;

  const candidates = [
    { diff: rDyn.wealth - rNone.wealth, name: `②暦年・動的最適（妻${ratioDyn}%）` },
    { diff: rSei.wealth - rNone.wealth, name: `③相続時精算課税（妻${ratioSei}%）` },
    { diff: rHyb.wealth - rNone.wealth, name: `④ハイブリッド[父精算・母暦年]（妻${ratioHyb}%）` }
  ];
  candidates.sort((a, b) => b.diff - a.diff);
  const best = candidates[0];
  const maxIncrease = Math.max(0, best.diff);

  const banner = document.getElementById("bannerBox");
  banner.classList.add("highlight");
  banner.textContent = `★ 対策により、子供に残せるお金が【 ${formatYen(maxIncrease)} 】増えます!（最適: ${best.name}）`;

  document.getElementById("resultMeta").textContent =
    `4パターン比較サマリー（宅地 ${config.land_area_sqm}㎡ / 特例上限 ${config.kakuchi_limit_sqm}㎡）`;
  document.getElementById("thDyn").innerHTML = `② 暦年・動的最適<br>(妻${ratioDyn}%)`;
  document.getElementById("thSei").innerHTML = `③ 相続時精算課税<br>(妻${ratioSei}%)`;
  document.getElementById("thHyb").innerHTML = `④ ハイブリッド<br>[父精算・母暦年](妻${ratioHyb}%)`;

  const rows = [
    { label: "子供最終手残り額", vals: [formatYen(rNone.wealth), formatYen(rDyn.wealth), formatYen(rSei.wealth), formatYen(rHyb.wealth)], cls: "row-em" },
    { label: "無対策比の増加額", vals: ["-", formatDiffYen(rDyn.wealth - rNone.wealth), formatDiffYen(rSei.wealth - rNone.wealth), formatDiffYen(rHyb.wealth - rNone.wealth)], cls: "row-em" },
    { label: "税金の総負担額", vals: [formatYen(totNone), formatYen(totDyn), formatYen(totSei), formatYen(totHyb)], cls: "row-tax" },
    { label: "　・贈与税（累計）", vals: ["0 円", formatYen(rDyn.giftTax), formatYen(rSei.giftTax), formatYen(rHyb.giftTax)], cls: "" },
    { label: "　・一次相続税（夫死亡）", vals: [formatYen(rNone.tax1), formatYen(rDyn.tax1), formatYen(rSei.tax1), formatYen(rHyb.tax1)], cls: "" },
    { label: "　・二次相続税（妻死亡）", vals: [formatYen(rNone.tax2), formatYen(rDyn.tax2), formatYen(rSei.tax2), formatYen(rHyb.tax2)], cls: "" }
  ];

  const tbody = document.getElementById("summaryBody");
  tbody.innerHTML = rows.map(r =>
    `<tr class="${r.cls}"><td>${r.label}</td>${r.vals.map(v => `<td>${v}</td>`).join("")}</tr>`
  ).join("");

  const scenarios = [
    { title: "① 無対策 (妻50%固定)", tl: rNone.timeline },
    { title: `② 暦年贈与・動的最適化 (妻${ratioDyn}%)`, tl: rDyn.timeline },
    { title: `③ 相続時精算課税 (妻${ratioSei}%)`, tl: rSei.timeline },
    { title: `④ 両親別ハイブリッド [父精算・母暦年] (妻${ratioHyb}%)`, tl: rHyb.timeline }
  ];

  let maxAsset = 0;
  for (const sc of scenarios) {
    for (const d of sc.tl) {
      maxAsset = Math.max(maxAsset, d.husband, d.wife, d.children);
    }
  }

  const chartsGrid = document.getElementById("chartsGrid");
  chartsGrid.innerHTML = scenarios.map((sc, idx) =>
    `<div class="chart-box"><h3>${sc.title}</h3><canvas id="chart_${idx}"></canvas></div>`
  ).join("");

  document.getElementById("resultSection").style.display = "block";
  scenarios.forEach((sc, idx) => {
    drawTimelineChart(document.getElementById(`chart_${idx}`), sc.tl, maxAsset);
  });
}

// ----------------------------------------------------------------------------
// 4. PWA Service Worker登録 & インストールプロンプト制御
// ----------------------------------------------------------------------------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById("installBtn");
  installBtn.style.display = "inline-block";
  installBtn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = "none";
  };
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyFormValues(DEFAULTS);
  document.getElementById("runBtn").addEventListener("click", runSimulation);
  document.getElementById("hybridBtn").addEventListener("click", () => applyFormValues(HYBRID_PRESET));
  document.getElementById("resetBtn").addEventListener("click", () => applyFormValues(DEFAULTS));
  document.getElementById("printBtn").addEventListener("click", () => window.print());
});
