// ============================================================================
// 相続・生前贈与 4パターン比較シミュレーター (v4) - JavaScript計算エンジン & UI
// ============================================================================

/**
 * 初期設定値（デフォルトのシミュレーション条件）
 */
const DEFAULTS = {
  husband_asset: 580000000,       // 夫の金融資産総額（円）
  husband_land_value: 100000000,  // 夫名義の宅地評価額（円）
  wife_asset: 20000000,           // 妻名義の金融資産総額（円）
  wife_land_value: 0,             // 妻名義の宅地評価額（円）
  land_area_sqm: 400,             // 宅地の面積（㎡）
  husband_life: 7,                // 一次相続（夫死亡）までの年数
  wife_life: 11,                  // 二次相続（妻死亡）までの年数
  num_children: 2,                // 子供の人数
  living_cost_couple: 3450000,    // 夫婦健在時の年間生活費（円）
  living_cost_single: 1950000,    // 妻単身時の年間生活費（円）
  return_rate_pct: 1.0,           // 年間期待運用利回り・地価変動率（%）
  apply_kakuchi_1st: true,        // 一次相続で小規模宅地等の特例を適用するか
  apply_kakuchi_2nd: true,        // 二次相続で小規模宅地等の特例を適用するか
  kakuchi_limit_sqm: 330,         // 小規模宅地等の特例の上限面積（㎡）
  seisan_annual_gift: 1100000     // 相続時精算課税の年間贈与額（円/人）
};

/**
 * ハイブリッド戦略（父：精算課税、母：暦年贈与）のメリットが出やすい条件プリセット
 */
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

// 直近のシミュレーション描画データを保持（リサイズや印刷時の再描画用）
let lastRenderState = null;

// ----------------------------------------------------------------------------
// 1. 税金計算ロジック
// ----------------------------------------------------------------------------

/**
 * 暦年贈与の贈与税額を計算する（特例税率：直系尊属から成人した子・孫への贈与を想定）
 * @param {number} amount - 1人あたりの年間贈与額（円）
 * @returns {number} 贈与税額（円）
 */
function calculateGiftTax(amount) {
  const taxable = amount - 1100000; // 基礎控除110万円を差し引く
  if (taxable <= 0) return 0;
  if (taxable <= 2000000) return taxable * 0.10;
  if (taxable <= 4000000) return taxable * 0.15 - 100000;
  if (taxable <= 6000000) return taxable * 0.20 - 300000;
  if (taxable <= 10000000) return taxable * 0.30 - 900000;
  if (taxable <= 15000000) return taxable * 0.40 - 1900000;
  if (taxable <= 30000000) return taxable * 0.45 - 2650000;
  return taxable * 0.55 - 4000000;
}

/**
 * 暦年贈与の限界税率（現在の贈与額に対する税率区分）を取得する
 * @param {number} amount - 1人あたりの年間贈与額（円）
 * @returns {number} 限界税率（0.0 〜 0.55）
 */
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

/**
 * 相続税の限界税率（法定相続分に応じた取得金額に基づく税率区分）を取得する
 * @param {number} netEstate - 正味遺産総額（円）
 * @param {number} numHeirs - 法定相続人の数
 * @returns {number} 限界税率（0.0 〜 0.55）
 */
function getInheritanceMarginalRate(netEstate, numHeirs) {
  const basicDeduction = 30000000 + 6000000 * numHeirs; // 基礎控除：3,000万円 + 600万円 × 法定相続人
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

/**
 * 相続税の限界税率と贈与税の限界税率を比較し、節税効果が高い最適な年間贈与額を探索する
 * @param {number} currentAsset - 現在の総資産額（円）
 * @param {number} numHeirs - 法定相続人の数
 * @param {number} numChildren - 子供の人数
 * @param {number} maxGiftPerChild - 子供1人あたりの年間贈与上限額（デフォルト300万円）
 * @returns {number} 子供1人あたりの最適年間贈与額（円）
 */
function findDynamicOptimumGift(currentAsset, numHeirs, numChildren, maxGiftPerChild = 3000000) {
  const inhRate = getInheritanceMarginalRate(currentAsset, numHeirs);
  if (inhRate === 0) return 0; // 相続税がかからない場合は贈与しない

  const maxTotalGift = numChildren * maxGiftPerChild;
  let bestGift = 1100000; // 最低でも基礎控除枠（110万円）までは非課税で贈与

  // 10万円刻みで贈与額を増やし、贈与税率が相続税率を上回らない最大値を探す
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

/**
 * 暦年贈与の「生前贈与加算（死亡前7年以内の持ち戻し）」と「贈与税額控除」を計算する（令和5年度税制改正対応）
 * @param {number[]} giftHistory - 年ごとの子供1人あたり贈与額の履歴配列
 * @param {number} numChildren - 子供の人数
 * @returns {{addToEstate: number, giftTaxCredit: number}} 相続財産への加算額と贈与税額控除額
 */
function calculate7YrAddbackAndCredit(giftHistory, numChildren) {
  const recent7 = giftHistory.slice(-7); // 直近7年分の履歴を抽出
  let addToEstate = 0;
  let giftTaxCredit = 0;

  // 新しい年（死亡日に近い年）から順に並べる
  const reversed = [...recent7].reverse();

  // 直近3年以内の贈与は全額が相続財産に加算され、支払った贈与税は全額控除される
  const recent3 = reversed.slice(0, 3);
  for (const gAmt of recent3) {
    addToEstate += gAmt * numChildren;
    giftTaxCredit += calculateGiftTax(gAmt) * numChildren;
  }

  // 4〜7年前の贈与は、合計額から100万円を控除した残額が加算され、按分した贈与税が控除される
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

/**
 * 小規模宅地等の特例（特定居住用宅地等：上限面積まで80%減額）適用後の宅地評価額を計算する
 * @param {number} landValue - 宅地の評価額（円）
 * @param {number} landAreaSqm - 宅地の面積（㎡）
 * @param {boolean} applyFlag - 特例を適用するかどうか
 * @param {number} limitSqm - 特例の上限面積（デフォルト330㎡）
 * @returns {number} 減額後の宅地評価額（円）
 */
function calculateKakuchiReducedLandValue(landValue, landAreaSqm, applyFlag, limitSqm = 330) {
  if (landValue <= 0 || !applyFlag) return landValue;
  if (landAreaSqm <= 0) return landValue * 0.20;

  // 上限面積までの割合を算出し、適用部分は80%減額（評価額20%）、超過部分は100%評価
  const applicableRatio = Math.min(1.0, limitSqm / landAreaSqm);
  const applicableValue = landValue * applicableRatio * 0.20;
  const excessValue = landValue * (1.0 - applicableRatio);
  return applicableValue + excessValue;
}

/**
 * 相続税の総額および配偶者税額軽減（1億6,000万円または法定相続分まで非課税）適用後の最終税額を計算する
 * @param {number} netEstate - 課税価格の合計額（円）
 * @param {number} numHeirs - 法定相続人の数
 * @param {number} giftTaxCredit - 贈与税額控除（円）
 * @param {number} actualSpouseRatio - 配偶者の実際の遺産取得割合（0.0 〜 1.0）
 * @returns {{finalTax: number, spouseActualHeritage: number}} 最終納付相続税額と配偶者取得額
 */
function calculateInheritanceTaxCore(netEstate, numHeirs, giftTaxCredit, actualSpouseRatio = 0.0) {
  const basicDeduction = 30000000 + 6000000 * numHeirs;
  const taxableEstate = netEstate - basicDeduction;
  if (taxableEstate <= 0) return { finalTax: 0, spouseActualHeritage: 0 };

  // 法定相続分に応じた取得金額ごとの税率と控除額
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

  // 配偶者の税額軽減の計算
  if (actualSpouseRatio > 0) {
    const legalSpouseLimit = netEstate * 0.5;
    const allowableLimit = Math.max(160000000, legalSpouseLimit); // 1.6億円と法定相続分(1/2)の大きい方
    const spouseTaxReduction = spouseActualHeritage <= allowableLimit
      ? totalInheritanceTax * actualSpouseRatio
      : totalInheritanceTax * (allowableLimit / netEstate);
    finalTax = totalInheritanceTax - spouseTaxReduction;
  }

  // 贈与税額控除を差し引く
  finalTax = Math.max(0, finalTax - giftTaxCredit);
  return { finalTax, spouseActualHeritage };
}

// ----------------------------------------------------------------------------
// 2. シミュレーション実行エンジン
// ----------------------------------------------------------------------------

/**
 * 指定された贈与戦略と配偶者取得割合に基づき、現在から二次相続完了までの資産推移・税額をシミュレートする
 * @param {object} config - 入力条件オブジェクト
 * @param {string} giftMode - 贈与モード ("none" | "dynamic" | "seisankaze" | "hybrid")
 * @param {number} spouseSharePct - 一次相続時の妻の遺産取得割合（0 〜 100%）
 * @returns {object} 最終手残り額、各種税額、年次推移データ
 */
function simulateInheritanceTimeline(config, giftMode = "none", spouseSharePct = 50) {
  // ハイブリッドの場合は、父（夫）は相続時精算課税、母（妻）は暦年贈与を行う
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

  // 相続時精算課税の累積加算額（110万円基礎控除超過分）と特別控除（2,500万円）使用額
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

  // === フェーズ1：現時点 〜 一次相続（夫死亡）までの年次処理 ===
  for (let year = 1; year <= yearsToFirst; year++) {
    const currentTotalH = husbandAsset + landValueH;
    const inhRateH = getInheritanceMarginalRate(currentTotalH, numChildren + 1);

    // 夫から子への生前贈与額の決定
    let giftAmtH = 0;
    if (husbandGiftMode === "dynamic") {
      giftAmtH = findDynamicOptimumGift(currentTotalH, numChildren + 1, numChildren);
    } else if (husbandGiftMode === "seisankaze") {
      giftAmtH = inhRateH > 0 ? config.seisan_annual_gift : 0;
    }

    // 夫の贈与実行と税金計算
    const totalGiftYearH = giftAmtH * numChildren;
    if (giftAmtH > 0 && husbandAsset >= totalGiftYearH) {
      husbandAsset -= totalGiftYearH;

      if (husbandGiftMode === "dynamic") {
        const taxH = calculateGiftTax(giftAmtH);
        childrenReceived += (giftAmtH - taxH) * numChildren;
        totalGiftTax += taxH * numChildren;
        husbandGiftHistory.push(giftAmtH);
      } else if (husbandGiftMode === "seisankaze") {
        // 新精算課税：年110万円の基礎控除を超えた分のみ特別控除2,500万円の枠を消費し、相続時に加算
        const excessOver110 = Math.max(0, giftAmtH - 1100000);
        const remDeduction = Math.max(0, 25000000 - seisanUsedSpecialDeductionH);
        const usedNow = Math.min(excessOver110, remDeduction);
        seisanUsedSpecialDeductionH += usedNow;

        const taxableSeisan = Math.max(0, excessOver110 - usedNow);
        const taxH = taxableSeisan * 0.20; // 特別控除超過分は一律20%

        seisanAddbackH += excessOver110 * numChildren;
        childrenReceived += (giftAmtH - taxH) * numChildren;
        totalGiftTax += taxH * numChildren;
        husbandGiftHistory.push(giftAmtH);
      }
    } else {
      husbandGiftHistory.push(0);
    }

    // ハイブリッドモード時は、一次相続前から妻自身の固有資産からも暦年贈与を実行（妻の生活防衛資金は確保）
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

    // 生活費の消費と運用利回り・地価変動の反映
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

  // === 一次相続（夫死亡）の遺産分割と相続税計算 ===
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

  // 小規模宅地等の特例適用後の土地評価額
  const appliedLandValue1st = calculateKakuchiReducedLandValue(
    landValueH, landArea, config.apply_kakuchi_1st, config.kakuchi_limit_sqm
  );

  // 課税遺産総額と分割対象遺産
  const estateForTax1st = husbandAsset + appliedLandValue1st + addToEstateH;
  const divisibleEstate1st = husbandAsset + appliedLandValue1st;
  const targetWifeShareVal = divisibleEstate1st * (spouseSharePct / 100.0);

  // 妻が優先的に宅地を取得すると仮定して土地と現金の配分を計算
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

  // 妻と子のそれぞれの相続税負担額を算出
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

  // 相続後の資産移転（夫の資産は0になり、妻と子へ引き継がれる）
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

  // === フェーズ2：一次相続後 〜 二次相続（妻死亡）までの年次処理 ===
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

    // 単身生活費の消費と運用利回りの反映
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

  // === 二次相続（妻死亡）の相続税計算と全資産の承継 ===
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

  // 二次相続では配偶者控除（actualSpouseRatio = 0.0）は使えない
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

/**
 * 一次相続時の妻の遺産取得割合（0%〜100%）を1%刻みで全探索し、子供の最終手残り額が最大になる割合を求める
 * @param {object} config - 入力条件オブジェクト
 * @param {string} giftMode - 贈与モード
 * @returns {number} 最適な妻の遺産取得割合（0 〜 100）
 */
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

/** 金額を「1,234,567 円」形式にフォーマット */
function formatYen(num) {
  return Math.round(num).toLocaleString("ja-JP") + " 円";
}

/** 差額を符号付きの「+1,234,567 円」形式にフォーマット */
function formatDiffYen(num) {
  const rounded = Math.round(num);
  const sign = rounded >= 0 ? "+" : "";
  return sign + rounded.toLocaleString("ja-JP") + " 円";
}

/** 金額をグラフ軸ラベル用の「〇億〇万円」形式にフォーマット */
function formatOkuMan(yenVal) {
  const manVal = Math.round(yenVal / 10000);
  if (manVal === 0) return "0円";
  const oku = Math.floor(manVal / 10000);
  const rem = manVal % 10000;
  if (oku > 0 && rem > 0) return `${oku}億${rem.toLocaleString()}万円`;
  if (oku > 0) return `${oku}億円`;
  return `${rem.toLocaleString()}万円`;
}

/** プリセット値や初期値をHTMLフォームに反映し、結果表示をリセットする */
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
  lastRenderState = null;
}

/** HTMLフォームから入力値を収集・バリデーションして設定オブジェクトを返す */
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

/**
 * 1〜4ページ目用：各パターンの資産推移折れ線グラフをCanvasに描画する
 * @param {HTMLCanvasElement} canvas - 描画対象のCanvas要素
 * @param {object[]} timeline - 年次資産推移データ
 * @param {number} maxAsset - 4パターン共通のY軸最大値
 */
function drawTimelineChart(canvas, timeline, maxAsset) {
  const dpr = Math.max(window.devicePixelRatio || 1, 2); // 高解像度（印刷対応）スケーリング
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padLeft = 104;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 42;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  ctx.clearRect(0, 0, w, h);

  // Y軸の目盛り計算（5,000万円単位で切り上げ）
  const stepUnit = 50000000;
  const rawMax = maxAsset > 0 ? maxAsset * 1.06 : 100000000;
  const yMax = Math.ceil(rawMax / stepUnit) * stepUnit;
  const steps = Math.max(4, Math.round(yMax / stepUnit));

  // 横グリッド線とY軸ラベルの描画
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#334155";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= steps; i++) {
    const val = (yMax / steps) * i;
    const y = padTop + plotH - (plotH * i) / steps;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.fillText(formatOkuMan(val), padLeft - 8, y);
  }

  // Y軸タイトルの描画（90度回転）
  ctx.save();
  ctx.translate(16, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "#1e293b";
  ctx.fillText("資産額（数千万円単位）", 0, 0);
  ctx.restore();

  // 縦グリッド線とX軸（経過年数）ラベルの描画
  const maxYear = timeline[timeline.length - 1].year || 1;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px sans-serif";
  const xStep = maxYear <= 16 ? 2 : 5;
  for (let yr = 0; yr <= maxYear; yr += xStep) {
    const x = padLeft + (plotW * yr) / maxYear;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
    ctx.fillText(`${yr}`, x, padTop + plotH + 8);
  }

  ctx.font = "bold 12px sans-serif";
  ctx.fillText("経過年数（年）", padLeft + plotW / 2, padTop + plotH + 25);

  // プロット領域の外枠
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(padLeft, padTop, plotW, plotH);

  // 3系列（夫・妻・子）の折れ線とマーカーを描画
  const series = [
    { key: "husband", color: "#1f77b4", label: "夫の資産（土地含む）", shape: "circle" },
    { key: "wife", color: "#ff7f0e", label: "妻の資産（土地含む）", shape: "square" },
    { key: "children", color: "#2ca02c", label: "子の累積受取額", shape: "triangle" }
  ];

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    timeline.forEach((d, idx) => {
      const x = padLeft + (plotW * d.year) / maxYear;
      const y = padTop + plotH - (plotH * d[s.key]) / yMax;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 各年のデータ点にマーカー（丸・四角・三角）を描画
    timeline.forEach((d) => {
      const x = padLeft + (plotW * d.year) / maxYear;
      const y = padTop + plotH - (plotH * d[s.key]) / yMax;
      ctx.beginPath();
      if (s.shape === "circle") {
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.shape === "square") {
        ctx.fillRect(x - 4, y - 4, 8, 8);
      } else {
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 4.8, y + 4);
        ctx.lineTo(x - 4.8, y + 4);
        ctx.closePath();
        ctx.fill();
      }
    });
  }

  // 左上の凡例ボックスを描画
  const legX = padLeft + 12;
  const legY = padTop + 10;
  const legW = 192;
  const legH = 74;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.fillRect(legX, legY, legW, legH);
  ctx.strokeRect(legX, legY, legW, legH);

  series.forEach((s, idx) => {
    const rowY = legY + 16 + idx * 21;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(legX + 10, rowY);
    ctx.lineTo(legX + 34, rowY);
    ctx.stroke();

    ctx.beginPath();
    if (s.shape === "circle") {
      ctx.arc(legX + 22, rowY, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.shape === "square") {
      ctx.fillRect(legX + 18, rowY - 4, 8, 8);
    } else {
      ctx.moveTo(legX + 22, rowY - 4.5);
      ctx.lineTo(legX + 26.5, rowY + 3.5);
      ctx.lineTo(legX + 17.5, rowY + 3.5);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = "#0f172a";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(s.label, legX + 42, rowY);
  });

  // 右上の「最終受取額」強調バッジを描画
  const finalChild = timeline[timeline.length - 1].children;
  const badgeText = `最終受取: ${formatOkuMan(finalChild)}`;
  ctx.font = "bold 13px sans-serif";
  const textW = ctx.measureText(badgeText).width;
  const badgeW = textW + 22;
  const badgeH = 28;
  const badgeX = padLeft + plotW - badgeW - 14;
  const badgeY = padTop + 14;

  ctx.fillStyle = "#f0fdf4";
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#15803d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);
}

/**
 * 5ページ目用：4パターンの税金総負担額の内訳比較（積み上げ棒グラフ）を描画する
 * @param {HTMLCanvasElement} canvas - 描画対象のCanvas要素
 * @param {object[]} taxItems - 各パターンの贈与税・一次相続税・二次相続税データ
 */
function drawTaxBreakdownChart(canvas, taxItems) {
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padLeft = 74;
  const padRight = 24;
  const padTop = 32;
  const padBottom = 42;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  ctx.clearRect(0, 0, w, h);

  // グラフタイトル
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("税金総負担額の内訳比較（万円）", padLeft + plotW / 2, 6);

  // Y軸の最大値と目盛りステップ計算（万円単位）
  const maxTotalMan = Math.max(...taxItems.map(d => (d.gift + d.tax1 + d.tax2) / 10000), 1000);
  const stepMan = Math.ceil((maxTotalMan * 1.18) / 5 / 500) * 500;
  const yMaxMan = stepMan * 5;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#334155";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 5; i++) {
    const valMan = stepMan * i;
    const y = padTop + plotH - (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.fillText(valMan.toLocaleString("ja-JP"), padLeft - 8, y);
  }

  // Y軸タイトル
  ctx.save();
  ctx.translate(16, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("税額（万円）", 0, 0);
  ctx.restore();

  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1.2;
  ctx.strokeRect(padLeft, padTop, plotW, plotH);

  // 各パターンの積み上げ棒グラフを描画
  const colW = plotW / taxItems.length;
  const barW = Math.min(72, colW * 0.42);

  taxItems.forEach((item, idx) => {
    const cx = padLeft + colW * (idx + 0.5);
    const bx = cx - barW / 2;

    const gMan = item.gift / 10000;
    const t1Man = item.tax1 / 10000;
    const t2Man = item.tax2 / 10000;
    const totMan = gMan + t1Man + t2Man;

    let curY = padTop + plotH;

    // 1段目：贈与税（青）
    if (gMan > 0) {
      const bh = (plotH * gMan) / yMaxMan;
      ctx.fillStyle = "#3b7ea1";
      ctx.fillRect(bx, curY - bh, barW, bh);
      curY -= bh;
    }
    // 2段目：一次相続税（オレンジ）
    if (t1Man > 0) {
      const bh = (plotH * t1Man) / yMaxMan;
      ctx.fillStyle = "#f28e2b";
      ctx.fillRect(bx, curY - bh, barW, bh);
      curY -= bh;
    }
    // 3段目：二次相続税（赤）
    if (t2Man > 0) {
      const bh = (plotH * t2Man) / yMaxMan;
      ctx.fillStyle = "#e15759";
      ctx.fillRect(bx, curY - bh, barW, bh);
      curY -= bh;
    }

    // 棒グラフ上部の合計税額ラベル
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(`合計 ${Math.round(totMan).toLocaleString("ja-JP")}万円`, cx, curY - 4);

    // X軸のパターン名ラベル（2行）
    ctx.fillStyle = "#1e293b";
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(item.line1, cx, padTop + plotH + 6);
    ctx.fillText(item.line2, cx, padTop + plotH + 21);
  });

  // 右上の凡例ボックス
  const legItems = [
    { color: "#3b7ea1", label: "贈与税（累計）" },
    { color: "#f28e2b", label: "一次相続税（夫死亡）" },
    { color: "#e15759", label: "二次相続税（妻死亡）" }
  ];
  const legW = 158;
  const legH = 64;
  const legX = padLeft + plotW - legW - 10;
  const legY = padTop + 8;

  ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.fillRect(legX, legY, legW, legH);
  ctx.strokeRect(legX, legY, legW, legH);

  legItems.forEach((li, i) => {
    const ry = legY + 14 + i * 19;
    ctx.fillStyle = li.color;
    ctx.fillRect(legX + 10, ry - 5, 14, 10);
    ctx.fillStyle = "#0f172a";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(li.label, legX + 30, ry);
  });
}

/** ウィンドウリサイズや印刷プレビュー切り替え時に全グラフを再描画する */
function redrawAllCharts() {
  if (!lastRenderState) return;
  const { scenarios, maxAsset, taxItems } = lastRenderState;
  scenarios.forEach((sc, idx) => {
    const canvas = document.getElementById(`chart_${idx}`);
    if (canvas) drawTimelineChart(canvas, sc.tl, maxAsset);
  });
  const taxCanvas = document.getElementById("taxBreakdownChart");
  if (taxCanvas) drawTaxBreakdownChart(taxCanvas, taxItems);
}

/**
 * メイン処理：4パターンのシミュレーションを実行し、結果テーブルとグラフを画面に描画する
 */
function runSimulation() {
  const config = collectConfig();
  if (!config) return;

  // ① 無対策（妻50%固定）
  const rNone = simulateInheritanceTimeline(config, "none", 50);

  // ② 暦年贈与・動的最適化（最適妻割合を探索）
  const ratioDyn = findBestSpouseShareRatio(config, "dynamic");
  const rDyn = simulateInheritanceTimeline(config, "dynamic", ratioDyn);

  // ③ 相続時精算課税（最適妻割合を探索）
  const ratioSei = findBestSpouseShareRatio(config, "seisankaze");
  const rSei = simulateInheritanceTimeline(config, "seisankaze", ratioSei);

  // ④ ハイブリッド［父精算・母暦年］（最適妻割合を探索）
  const ratioHyb = findBestSpouseShareRatio(config, "hybrid");
  const rHyb = simulateInheritanceTimeline(config, "hybrid", ratioHyb);

  // 各パターンの税金総負担額
  const totNone = rNone.tax1 + rNone.tax2;
  const totDyn = rDyn.giftTax + rDyn.tax1 + rDyn.tax2;
  const totSei = rSei.giftTax + rSei.tax1 + rSei.tax2;
  const totHyb = rHyb.giftTax + rHyb.tax1 + rHyb.tax2;

  // 最も子供の手残り額が多くなる最適戦略を判定
  const candidates = [
    { diff: rDyn.wealth - rNone.wealth, name: `②暦年・動的最適（妻${ratioDyn}%）` },
    { diff: rSei.wealth - rNone.wealth, name: `③相続時精算課税（妻${ratioSei}%）` },
    { diff: rHyb.wealth - rNone.wealth, name: `④ハイブリッド[父精算・母暦年]（妻${ratioHyb}%）` }
  ];
  candidates.sort((a, b) => b.diff - a.diff);
  const best = candidates[0];
  const maxIncrease = Math.max(0, best.diff);

  // 結果バナーの更新（画面表示用と印刷用5ページ目の両方）
  const bannerText = `★ 対策により、子供に残せるお金が【 ${formatYen(maxIncrease)} 】増えます!（最適: ${best.name}）`;
  const banner = document.getElementById("bannerBox");
  banner.classList.add("highlight");
  banner.textContent = bannerText;
  document.getElementById("printBannerBox").textContent = bannerText;

  // 比較サマリー表のヘッダーと行データを生成
  document.getElementById("resultMeta").textContent =
    `宅地面積: ${config.land_area_sqm}㎡（特例上限 ${config.kakuchi_limit_sqm}㎡・面積按分） / 最適妻割合: 暦年 ${ratioDyn}%・精算 ${ratioSei}%・ハイブリッド ${ratioHyb}%`;
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

  // 1〜4ページ目の折れ線グラフ用データを準備
  const scenarios = [
    { title: "① 無対策（ベースライン 妻50%固定）", tl: rNone.timeline },
    { title: `② 暦年贈与・動的最適化（妻取得割合: ${ratioDyn}%）`, tl: rDyn.timeline },
    { title: `③ 相続時精算課税・年${Math.round(config.seisan_annual_gift / 10000)}万枠活用（妻取得割合: ${ratioSei}%）`, tl: rSei.timeline },
    { title: `④ 両親別ハイブリッド [父精算・母暦年]（妻取得割合: ${ratioHyb}%）`, tl: rHyb.timeline }
  ];

  // 全グラフでY軸のスケールを統一するため最大資産額を算出
  let maxAsset = 0;
  for (const sc of scenarios) {
    for (const d of sc.tl) {
      maxAsset = Math.max(maxAsset, d.husband, d.wife, d.children);
    }
  }

  // 各パターンのグラフ領域（印刷時は1ページ1グラフ）をHTMLに挿入
  const chartsGrid = document.getElementById("chartsGrid");
  chartsGrid.innerHTML = scenarios.map((sc, idx) =>
    `<div class="report-page"><h3>${sc.title}</h3><div class="chart-wrap"><canvas id="chart_${idx}"></canvas></div></div>`
  ).join("");

  // 5ページ目の税金内訳棒グラフ用データを準備
  const taxItems = [
    { line1: "① 無対策", line2: "(妻50%)", gift: 0, tax1: rNone.tax1, tax2: rNone.tax2 },
    { line1: "② 暦年・動的最適", line2: `(妻${ratioDyn}%)`, gift: rDyn.giftTax, tax1: rDyn.tax1, tax2: rDyn.tax2 },
    { line1: "③ 相続時精算課税", line2: `(妻${ratioSei}%)`, gift: rSei.giftTax, tax1: rSei.tax1, tax2: rSei.tax2 },
    { line1: "④ ハイブリッド", line2: `(妻${ratioHyb}%)`, gift: rHyb.giftTax, tax1: rHyb.tax1, tax2: rHyb.tax2 }
  ];

  lastRenderState = { scenarios, maxAsset, taxItems };

  document.getElementById("resultSection").style.display = "block";
  redrawAllCharts();
}

// ----------------------------------------------------------------------------
// 4. PWA Service Worker登録 & インストールプロンプト制御
// ----------------------------------------------------------------------------

// ブラウザの「ホーム画面に追加 / アプリとしてインストール」イベントを捕捉
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

// オフライン動作のためのService Workerを登録
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// 画面リサイズや印刷プレビューの前後でCanvasサイズを自動調整
window.addEventListener("resize", redrawAllCharts);
window.addEventListener("beforeprint", redrawAllCharts);
window.addEventListener("afterprint", redrawAllCharts);

// ページ読み込み完了時の初期化と各種ボタンのイベント登録
document.addEventListener("DOMContentLoaded", () => {
  applyFormValues(DEFAULTS);
  document.getElementById("runBtn").addEventListener("click", runSimulation);
  document.getElementById("hybridBtn").addEventListener("click", () => applyFormValues(HYBRID_PRESET));
  document.getElementById("resetBtn").addEventListener("click", () => applyFormValues(DEFAULTS));
  document.getElementById("printBtn").addEventListener("click", () => {
    if (!lastRenderState) runSimulation();
    if (lastRenderState) {
      redrawAllCharts();
      setTimeout(() => window.print(), 100);
    }
  });
});
