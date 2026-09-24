"use strict";
(() => {
  // supabase/functions/_shared/math-engine.ts
  function n(v, fallback = 0) {
    const parsed = parseFloat(String(v ?? fallback));
    return isNaN(parsed) ? fallback : parsed;
  }
  function ni(v, fallback = 0) {
    const parsed = parseInt(String(v ?? fallback), 10);
    return isNaN(parsed) ? fallback : parsed;
  }
  function normalizeAssetClass(raw) {
    const s = String(raw || "commercial").toLowerCase().trim();
    if (s.includes("single") || s.includes("residential") || s === "sf") return "single-family";
    if (s.includes("multi") || s.includes("apartment") || s === "mf") return "multi-unit";
    if (s.includes("storage") || s.includes("self_storage")) return "storage";
    return "commercial";
  }
  function calculateMonthlyPayment(loanAmount, annualRate, termYears) {
    if (loanAmount <= 0 || termYears <= 0) return 0;
    const r = annualRate / 100 / 12;
    const numPayments = termYears * 12;
    if (r === 0) return loanAmount / numPayments;
    return loanAmount * (r * Math.pow(1 + r, numPayments)) / (Math.pow(1 + r, numPayments) - 1);
  }
  function calculateRemainingBalance(loanAmount, annualRate, termYears, elapsedYears) {
    if (loanAmount <= 0) return 0;
    if (elapsedYears >= termYears) return 0;
    const r = annualRate / 100 / 12;
    const numPayments = termYears * 12;
    const p = elapsedYears * 12;
    if (r === 0) return loanAmount * (1 - p / numPayments);
    const mp = calculateMonthlyPayment(loanAmount, annualRate, termYears);
    return loanAmount * Math.pow(1 + r, p) - mp * (Math.pow(1 + r, p) - 1) / r;
  }
  function getAnnualAmortization(loanAmount, annualRate, termYears, options = {}) {
    const schedule = [];
    const finType = String(options.financingType || "fixed").toLowerCase();
    const armInitial = parseInt(options.armInitialYears || 5, 10);
    const armAdjRate = options.armAdjustmentRate !== void 0 ? parseFloat(options.armAdjustmentRate) : annualRate + 1.5;
    const armCap = options.armRateCap !== void 0 ? parseFloat(options.armRateCap) : annualRate + 4;
    const ioYears = parseInt(options.interestOnlyYears !== void 0 ? options.interestOnlyYears : finType === "interest_only" ? 3 : 0, 10);
    const holdYears = parseInt(options.holdingPeriod || options.exitYear || options.holdYears || 10, 10);
    const maxYears = Math.max(1, Math.min(30, isNaN(holdYears) ? 10 : holdYears));
    const firstYearMonths = options.firstYearMonths && options.firstYearMonths >= 1 && options.firstYearMonths <= 12 ? parseInt(options.firstYearMonths, 10) : 12;
    if (loanAmount <= 0 || termYears <= 0) {
      for (let year = 1; year <= maxYears; year++) {
        schedule.push({
          year,
          appliedRate: annualRate,
          isInterestOnly: false,
          isArmAdjusted: false,
          beginningBalance: 0,
          totalPayment: 0,
          principalPaid: 0,
          interestPaid: 0,
          endingBalance: 0,
          cumulativePrincipalPaid: 0,
          operatingMonths: year === 1 ? firstYearMonths : 12
        });
      }
      return schedule;
    }
    let currentBalance = loanAmount;
    let cumulativePrincipal = 0;
    for (let year = 1; year <= maxYears; year++) {
      const startBalance = currentBalance;
      let principalPaidThisYear = 0;
      let interestPaidThisYear = 0;
      let totalPaymentThisYear = 0;
      const monthsInThisYear = year === 1 ? firstYearMonths : 12;
      if (currentBalance <= 0 || year > termYears) {
        schedule.push({
          year,
          appliedRate: annualRate,
          isInterestOnly: false,
          isArmAdjusted: false,
          beginningBalance: 0,
          totalPayment: 0,
          principalPaid: 0,
          interestPaid: 0,
          endingBalance: 0,
          cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
          operatingMonths: monthsInThisYear
        });
        continue;
      }
      let yearRate = annualRate;
      let isArmAdjusted = false;
      if (finType === "arm" && year > armInitial) {
        yearRate = Math.min(armCap, Math.max(0, armAdjRate));
        isArmAdjusted = true;
      }
      let isInterestOnly = false;
      if (finType === "interest_only" && year <= ioYears) {
        isInterestOnly = true;
      } else if (finType === "bridge") {
        isInterestOnly = true;
      } else if (finType === "seller_financing" && ioYears > 0 && year <= ioYears) {
        isInterestOnly = true;
      }
      const r = yearRate / 100 / 12;
      if (isInterestOnly) {
        const monthlyInterest = currentBalance * r;
        interestPaidThisYear = monthlyInterest * monthsInThisYear;
        principalPaidThisYear = 0;
        totalPaymentThisYear = interestPaidThisYear;
      } else {
        let remainingYearsForPayment = termYears - (year - 1);
        if (finType === "interest_only") {
          remainingYearsForPayment = Math.max(1, termYears - ioYears - (year - ioYears - 1));
        }
        if (remainingYearsForPayment < 1) remainingYearsForPayment = 1;
        const monthlyPayment = calculateMonthlyPayment(currentBalance, yearRate, remainingYearsForPayment);
        for (let month = 1; month <= monthsInThisYear; month++) {
          let interestDue = currentBalance * r;
          let principalDue = monthlyPayment - interestDue;
          if (r === 0) {
            interestDue = 0;
            principalDue = monthlyPayment;
          }
          if (currentBalance < principalDue) {
            principalDue = currentBalance;
          }
          const actualPayment = principalDue + interestDue;
          totalPaymentThisYear += actualPayment;
          interestPaidThisYear += interestDue;
          principalPaidThisYear += principalDue;
          currentBalance -= principalDue;
          if (currentBalance <= 0) break;
        }
      }
      cumulativePrincipal += principalPaidThisYear;
      schedule.push({
        year,
        appliedRate: Math.round(yearRate * 100) / 100,
        isInterestOnly,
        isArmAdjusted,
        beginningBalance: Math.round(startBalance * 100) / 100,
        totalPayment: Math.round(totalPaymentThisYear * 100) / 100,
        principalPaid: Math.round(principalPaidThisYear * 100) / 100,
        interestPaid: Math.round(interestPaidThisYear * 100) / 100,
        endingBalance: Math.max(0, Math.round(currentBalance * 100) / 100),
        cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
        operatingMonths: monthsInThisYear
      });
    }
    return schedule;
  }
  function getMonthlyAmortization(loanAmount, annualRate, termYears, options = {}) {
    const schedule = [];
    if (loanAmount <= 0 || termYears <= 0) return schedule;
    const totalMonths = parseInt(options.totalMonths || (options.holdingPeriod || 10) * 12, 10);
    const finType = String(options.financingType || "fixed").toLowerCase();
    const armInitialMonths = parseInt(options.armInitialYears || 5, 10) * 12;
    const armAdjRate = options.armAdjustmentRate !== void 0 ? parseFloat(options.armAdjustmentRate) : annualRate + 1.5;
    const armCap = options.armRateCap !== void 0 ? parseFloat(options.armRateCap) : annualRate + 4;
    const ioMonths = parseInt(options.interestOnlyYears !== void 0 ? options.interestOnlyYears : finType === "interest_only" ? 3 : 0, 10) * 12;
    let currentBalance = loanAmount;
    let cumulativePrincipal = 0;
    let cumulativeInterest = 0;
    for (let m = 1; m <= totalMonths; m++) {
      const startBal = currentBalance;
      if (currentBalance <= 0 || m > termYears * 12) {
        schedule.push({
          month: m,
          appliedRate: annualRate,
          isInterestOnly: false,
          beginningBalance: 0,
          payment: 0,
          principalPaid: 0,
          interestPaid: 0,
          endingBalance: 0,
          cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
          cumulativeInterestPaid: Math.round(cumulativeInterest * 100) / 100
        });
        continue;
      }
      let monthRate = annualRate;
      if (finType === "arm" && m > armInitialMonths) {
        monthRate = Math.min(armCap, Math.max(0, armAdjRate));
      }
      let isIO = false;
      if (finType === "interest_only" && m <= ioMonths) isIO = true;
      else if (finType === "bridge") isIO = true;
      else if (finType === "seller_financing" && ioMonths > 0 && m <= ioMonths) isIO = true;
      const r = monthRate / 100 / 12;
      let payment = 0;
      let interestPaid = 0;
      let principalPaid = 0;
      if (isIO) {
        interestPaid = currentBalance * r;
        principalPaid = 0;
        payment = interestPaid;
      } else {
        const remainingMonths = Math.max(1, termYears * 12 - (m - 1));
        payment = calculateMonthlyPayment(currentBalance, monthRate, remainingMonths / 12);
        interestPaid = r === 0 ? 0 : currentBalance * r;
        principalPaid = payment - interestPaid;
        if (currentBalance < principalPaid) {
          principalPaid = currentBalance;
          payment = principalPaid + interestPaid;
        }
        currentBalance = Math.max(0, currentBalance - principalPaid);
      }
      cumulativePrincipal += principalPaid;
      cumulativeInterest += interestPaid;
      schedule.push({
        month: m,
        appliedRate: Math.round(monthRate * 100) / 100,
        isInterestOnly: isIO,
        beginningBalance: Math.round(startBal * 100) / 100,
        payment: Math.round(payment * 100) / 100,
        principalPaid: Math.round(principalPaid * 100) / 100,
        interestPaid: Math.round(interestPaid * 100) / 100,
        endingBalance: Math.round(currentBalance * 100) / 100,
        cumulativePrincipalPaid: Math.round(cumulativePrincipal * 100) / 100,
        cumulativeInterestPaid: Math.round(cumulativeInterest * 100) / 100
      });
    }
    return schedule;
  }
  function calculateNPV(rate, cashFlows) {
    const r = rate / 100;
    let npv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + r, t);
    }
    return Math.round(npv);
  }
  function calculateIRR(initialCashOrFlows, optionalFlows) {
    let initialCash = 0;
    let cashFlows = [];
    if (Array.isArray(initialCashOrFlows)) {
      if (initialCashOrFlows.length === 0) return 0;
      initialCash = Math.abs(initialCashOrFlows[0]);
      cashFlows = initialCashOrFlows.slice(1);
    } else {
      initialCash = n(initialCashOrFlows);
      cashFlows = optionalFlows || [];
    }
    if (initialCash <= 0 || cashFlows.length === 0) return 0;
    function getNPV(rate) {
      let sum = -initialCash;
      for (let i = 0; i < cashFlows.length; i++) {
        sum += cashFlows[i] / Math.pow(1 + rate, i + 1);
      }
      return sum;
    }
    const fullFlows = [-initialCash, ...cashFlows];
    const maxIter = 500;
    const tol = 1e-6;
    let r = 0.1;
    let converged = false;
    for (let i = 0; i < maxIter; i++) {
      let fv = 0;
      let fd = 0;
      for (let t = 0; t < fullFlows.length; t++) {
        const denom = Math.pow(1 + r, t);
        fv += fullFlows[t] / denom;
        if (t > 0) fd -= t * fullFlows[t] / Math.pow(1 + r, t + 1);
      }
      if (Math.abs(fv) < tol) {
        r = Math.min(10, Math.max(-0.99, r));
        converged = true;
        break;
      }
      if (Math.abs(fd) < 1e-12) break;
      const nextR = r - fv / fd;
      if (Math.abs(nextR - r) < tol) {
        r = Math.min(10, Math.max(-0.99, nextR));
        converged = true;
        break;
      }
      if (nextR < -0.99 || nextR > 10) break;
      r = nextR;
    }
    if (converged) {
      return Math.round(r * 1e4) / 100;
    }
    let low = -0.99;
    let high = 10;
    if (getNPV(high) > 0) {
      return 1e3;
    }
    if (getNPV(low) < 0 && getNPV(high) < 0) {
      return -99;
    }
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      const npvVal = getNPV(mid);
      if (Math.abs(npvVal) < 1e-4) {
        return Math.round(mid * 1e4) / 100;
      }
      if (npvVal > 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return Math.round((low + high) / 2 * 1e4) / 100;
  }
  function calculateProjections(rawAssetType, inputs = {}) {
    const assetType = normalizeAssetClass(rawAssetType);
    const assessedFallback = parseFloat(inputs.totalAssessedValue) || parseFloat(inputs.combinedAssessedValue) || 0;
    const purchasePrice = parseFloat(inputs.purchasePrice) > 0 ? parseFloat(inputs.purchasePrice) : assessedFallback > 0 ? assessedFallback : parseFloat(inputs.purchasePrice) || 0;
    const downPaymentPercent = parseFloat(inputs.downPaymentPercent) || 0;
    const interestRate = parseFloat(inputs.interestRate) || 0;
    const loanTerm = parseInt(inputs.loanTerm) || parseInt(inputs.loanTermYears) || parseInt(inputs.amortizationYears) || 30;
    const rehabCosts = parseFloat(inputs.rehabCosts) || parseFloat(inputs.rehabBudget) || 0;
    const closingCosts = parseFloat(inputs.closingCosts) || 0;
    const vacancyRate = parseFloat(inputs.vacancyRate) || parseFloat(inputs.vacancyRatePercent) || 0;
    const appreciationRate = parseFloat(inputs.appreciationRate) || 0;
    const rentGrowth = parseFloat(inputs.rentGrowth) || parseFloat(inputs.rentGrowthPercent) || parseFloat(inputs.annualRentGrowth) || 0;
    const expenseRatio = parseFloat(inputs.expenseRatio) || parseFloat(inputs.operatingExpenseRatio) || 0;
    const rawHoldingPeriod = parseInt(inputs.holdingPeriod || inputs.exitYear || inputs.holdYears || 10, 10);
    const holdingPeriod = Math.max(1, Math.min(30, isNaN(rawHoldingPeriod) ? 10 : rawHoldingPeriod));
    const exitYear = Math.max(1, Math.min(holdingPeriod, parseInt(inputs.exitYear || holdingPeriod, 10)));
    const arv = parseFloat(inputs.arv) || 0;
    const initialPropertyValue = assetType === "single-family" && arv > 0 ? arv : purchasePrice;
    const targetCapRate = parseFloat(inputs.targetCapRate) || parseFloat(inputs.targetExitCapRate) || parseFloat(inputs.exitCapRate) || 6.5;
    let year1GrossIncome = 0;
    const unitCount = parseInt(inputs.unitCount || inputs.numUnits || inputs.totalUnits || 0, 10);
    const storageRent = parseFloat(inputs.storageRentPerUnit || inputs.storageRent || 0);
    const rentPerSqFt = parseFloat(inputs.rentPerSqFt || 0);
    const totalSqFt = parseFloat(inputs.totalSqFt || inputs.storageSqFt || inputs.gla || 0);
    const explicitGrossAnnual = parseFloat(inputs.grossRentAnnual || inputs.grossRevenueAnnual || inputs.annualRent || inputs.grossAnnualRent || 0);
    const explicitGrossMonthly = parseFloat(inputs.grossRentPerMonth || inputs.grossRentMonthly || inputs.monthlyGrossRent || 0);
    const explicitStorageMonthly = parseFloat(inputs.storageGrossRentMonthly || inputs.grossStorageRentMonthly || 0);
    switch (assetType) {
      case "single-family":
        if (explicitGrossAnnual > 0) {
          year1GrossIncome = explicitGrossAnnual;
        } else if (explicitGrossMonthly > 0) {
          year1GrossIncome = explicitGrossMonthly * 12;
        } else if (inputs.monthlyRent) {
          year1GrossIncome = parseFloat(inputs.monthlyRent) * 12;
        }
        break;
      case "multi-unit":
        if (explicitGrossAnnual > 0) {
          year1GrossIncome = explicitGrossAnnual;
        } else if (explicitGrossMonthly > 0) {
          year1GrossIncome = explicitGrossMonthly * 12;
        } else if (unitCount > 0 && inputs.monthlyRentPerUnit) {
          year1GrossIncome = unitCount * parseFloat(inputs.monthlyRentPerUnit) * 12;
        } else if (inputs.monthlyRent) {
          year1GrossIncome = parseFloat(inputs.monthlyRent) * 12;
        }
        break;
      case "commercial":
        if (explicitGrossAnnual > 0) {
          year1GrossIncome = explicitGrossAnnual;
        } else if (explicitGrossMonthly > 0) {
          year1GrossIncome = explicitGrossMonthly * 12;
        } else if (Array.isArray(inputs.leases) && inputs.leases.length > 0) {
          year1GrossIncome = inputs.leases.reduce(
            (sum, l) => sum + n(l.monthlyRent) * 12,
            0
          );
        } else if (inputs.monthlyRent) {
          year1GrossIncome = parseFloat(inputs.monthlyRent) * 12;
        }
        break;
      case "storage":
        if (explicitGrossAnnual > 0) {
          year1GrossIncome = explicitGrossAnnual;
        } else if (explicitGrossMonthly > 0) {
          year1GrossIncome = explicitGrossMonthly * 12;
        } else if (explicitStorageMonthly > 0) {
          year1GrossIncome = explicitStorageMonthly * 12;
        } else if (storageRent > 0) {
          year1GrossIncome = (unitCount || 1) * storageRent * 12;
        } else if (totalSqFt > 0 && rentPerSqFt > 0) {
          year1GrossIncome = totalSqFt * rentPerSqFt * 12;
        }
        break;
    }
    const rehabFinancingMode = inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? "roll_into_loan" : "out_of_pocket");
    const isRehabFinanced = rehabFinancingMode === "roll_into_loan";
    const downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
    const baseLoan = Math.max(0, purchasePrice - downPaymentAmount);
    const loanAmount = isRehabFinanced ? baseLoan + rehabCosts + closingCosts : baseLoan;
    const initialCashInvested = isRehabFinanced ? downPaymentAmount : downPaymentAmount + rehabCosts + closingCosts;
    const initialEquity = initialPropertyValue - loanAmount;
    const monthlyPayment = calculateMonthlyPayment(loanAmount, interestRate, loanTerm);
    const annualDebtService = monthlyPayment * 12;
    const isProrateFirstYear = !!inputs.prorateFirstYear;
    let firstYearOperatingMonths = 12;
    if (isProrateFirstYear) {
      if (inputs.firstYearMonths !== void 0 && !isNaN(parseInt(inputs.firstYearMonths, 10))) {
        firstYearOperatingMonths = Math.max(1, Math.min(12, parseInt(inputs.firstYearMonths, 10)));
      } else if (inputs.closingDate) {
        const parts = String(inputs.closingDate).split(/[-/]/);
        let closeMonth = 10;
        if (parts.length >= 2) {
          closeMonth = parts[0].length === 4 ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
        }
        if (!isNaN(closeMonth) && closeMonth >= 1 && closeMonth <= 12) {
          firstYearOperatingMonths = Math.max(1, 12 - closeMonth + 1);
        }
      } else {
        firstYearOperatingMonths = 3;
      }
    }
    const finOptions = {
      financingType: inputs.financingType || "fixed",
      armInitialYears: inputs.armInitialYears ?? 5,
      armAdjustmentRate: inputs.armAdjustmentRate,
      armRateCap: inputs.armRateCap,
      interestOnlyYears: inputs.interestOnlyYears,
      sellerFinanceBalloon: inputs.sellerFinanceBalloon,
      holdingPeriod,
      firstYearMonths: isProrateFirstYear ? firstYearOperatingMonths : 12
    };
    const amortizationSchedule = getAnnualAmortization(loanAmount, interestRate, loanTerm, finOptions);
    const projections = [];
    let currentPropertyValue = initialPropertyValue;
    let currentGrossIncome = year1GrossIncome;
    let cumulativePrincipalPaid = 0;
    let cumulativeCashInvested = initialCashInvested;
    let entryCapRate = 0;
    for (let year = 1; year <= holdingPeriod; year++) {
      const isStubYear = year === 1 && isProrateFirstYear;
      const operatingMonths = isStubYear ? firstYearOperatingMonths : 12;
      const yearFraction = operatingMonths / 12;
      if (year > 1) {
        currentGrossIncome = currentGrossIncome * (1 + rentGrowth / 100);
      }
      const vacancyLoss = currentGrossIncome * (vacancyRate / 100);
      const effectiveGrossIncome = currentGrossIncome - vacancyLoss;
      let operatingExpenses = 0;
      let capexReserve = 0;
      if (assetType === "single-family") {
        const managementFee = inputs.manageProperty ? currentGrossIncome * 0.1 : 0;
        const maintenanceReserve = purchasePrice * 0.01;
        const turnoverReserve = currentGrossIncome / 12 * (vacancyRate / 100) * 0.5;
        operatingExpenses = currentGrossIncome * (expenseRatio / 100) + managementFee + maintenanceReserve + turnoverReserve;
      } else if (assetType === "multi-unit") {
        let pmRate = 0.03;
        if (inputs.manageProperty) {
          pmRate = unitCount && unitCount <= 4 ? 0.09 : 0.05;
        }
        const managementFee = effectiveGrossIncome * pmRate;
        operatingExpenses = currentGrossIncome * (expenseRatio / 100) + managementFee;
        capexReserve = (unitCount || 1) * 350;
      } else if (assetType === "commercial") {
        const isVacantOrRawLand = currentGrossIncome <= 0 || !!inputs.isVacantLot || !!inputs.isVacantLand || /vacant|land|dirt|lot/i.test(inputs.facilityType || "") || /vacant|land/i.test(inputs.useCode || "");
        if (isVacantOrRawLand && currentGrossIncome <= 0) {
          const assessedVal = parseFloat(inputs.totalAssessedValue) || parseFloat(inputs.combinedAssessedValue) || purchasePrice;
          const annualTaxes = parseFloat(inputs.annualTaxes) || parseFloat(inputs.propertyTaxes) || assessedVal * 0.011;
          const annualInsurance = parseFloat(inputs.annualInsurance) || parseFloat(inputs.insurance) || 600;
          const annualMaint = parseFloat(inputs.annualMaintenance) || parseFloat(inputs.maintenance) || 600;
          operatingExpenses = annualTaxes + annualInsurance + annualMaint;
          capexReserve = 0;
        } else {
          if (inputs.leaseType === "NNN") {
            operatingExpenses = currentGrossIncome * (expenseRatio / 100);
          } else {
            const managementFee = inputs.manageProperty ? currentGrossIncome * 0.035 : 0;
            operatingExpenses = currentGrossIncome * (expenseRatio / 100) + managementFee;
          }
          const isRawLand = /vacant|land|dirt|lot/i.test(inputs.facilityType || "") || /vacant|land/i.test(inputs.useCode || "");
          const gla = isRawLand ? 0 : parseFloat(inputs.gla) || 15e3;
          capexReserve = gla * 1.5;
        }
      } else if (assetType === "storage") {
        const managementFee = inputs.manageProperty ? currentGrossIncome * 0.06 : 0;
        const payrollMarketingRatio = inputs.isAutomated ? 0.04 : 0.13;
        operatingExpenses = currentGrossIncome * (expenseRatio / 100) + managementFee + currentGrossIncome * payrollMarketingRatio;
        capexReserve = effectiveGrossIncome * 0.03;
      }
      const netOperatingIncome = effectiveGrossIncome - operatingExpenses;
      let appliedGross = currentGrossIncome;
      let appliedVacancy = vacancyLoss;
      let appliedEGI = effectiveGrossIncome;
      let appliedOpex = operatingExpenses;
      let appliedCapex = capexReserve;
      let appliedNOI = netOperatingIncome;
      if (isStubYear) {
        appliedGross = currentGrossIncome * yearFraction;
        appliedVacancy = vacancyLoss * yearFraction;
        appliedEGI = effectiveGrossIncome * yearFraction;
        appliedOpex = operatingExpenses * yearFraction;
        appliedCapex = capexReserve * yearFraction;
        appliedNOI = appliedEGI - appliedOpex;
      }
      if (year === 1) {
        if (initialPropertyValue > 0 && netOperatingIncome > 0) {
          entryCapRate = netOperatingIncome / initialPropertyValue * 100;
        } else {
          entryCapRate = targetCapRate;
        }
      }
      const isIncomeProducing = currentGrossIncome > 0 && netOperatingIncome > 0;
      if ((assetType === "commercial" || assetType === "storage") && isIncomeProducing) {
        const exitCapTiming = inputs.exitCapTiming || "amortized";
        if (year === 1) {
          currentPropertyValue = initialPropertyValue;
        } else {
          if (exitCapTiming === "day1" || exitCapTiming === "immediate") {
            currentPropertyValue = targetCapRate > 0 ? netOperatingIncome / (targetCapRate / 100) : initialPropertyValue;
          } else {
            const capRateStep = (targetCapRate - entryCapRate) / Math.max(1, holdingPeriod - 1);
            const currentYearCapRate = entryCapRate + capRateStep * (year - 1);
            currentPropertyValue = currentYearCapRate > 0 ? netOperatingIncome / (currentYearCapRate / 100) : initialPropertyValue;
          }
        }
      } else {
        if (year > 1) {
          const appRate = appreciationRate !== void 0 && !isNaN(appreciationRate) ? appreciationRate : 3;
          currentPropertyValue = currentPropertyValue * (1 + appRate / 100);
        }
      }
      const yearAmort = amortizationSchedule[year - 1] || {};
      const currentDebtService = yearAmort.totalPayment !== void 0 ? yearAmort.totalPayment : isStubYear ? annualDebtService * yearFraction : annualDebtService;
      const principalPaid = yearAmort.principalPaid !== void 0 ? yearAmort.principalPaid : 0;
      const interestPaid = yearAmort.interestPaid !== void 0 ? yearAmort.interestPaid : currentDebtService;
      cumulativePrincipalPaid += principalPaid;
      const cashFlow = (isStubYear ? appliedNOI : netOperatingIncome) - currentDebtService - (isStubYear ? appliedCapex : capexReserve);
      let cashInjection = 0;
      if (cashFlow < 0) {
        cashInjection = Math.abs(cashFlow);
        cumulativeCashInvested += cashInjection;
      }
      const isZeroInitialCash = cumulativeCashInvested <= 0;
      const isCoCNotMeaningful = isZeroInitialCash && cashFlow > 0;
      const cashOnCash = cumulativeCashInvested > 0 ? cashFlow / cumulativeCashInvested * 100 : 0;
      const cashOnCashDisplay = isCoCNotMeaningful ? "N/M" : (Math.round(cashOnCash * 100) / 100).toFixed(2) + "%";
      const capRate = currentPropertyValue > 0 ? netOperatingIncome / currentPropertyValue * 100 : 0;
      const remainingLoanBalance = yearAmort.endingBalance !== void 0 ? yearAmort.endingBalance : calculateRemainingBalance(loanAmount, interestRate, loanTerm, year);
      const equity = currentPropertyValue - remainingLoanBalance;
      const activeNOI = isStubYear ? appliedNOI : netOperatingIncome;
      const dscr = currentDebtService > 0 ? activeNOI / currentDebtService : null;
      const debtYield = loanAmount > 0 ? activeNOI / loanAmount * 100 : null;
      const ltv = currentPropertyValue > 0 ? remainingLoanBalance / currentPropertyValue * 100 : 0;
      projections.push({
        year,
        propertyValue: Math.round(currentPropertyValue * 100) / 100,
        grossPotentialIncome: Math.round((isStubYear ? appliedGross : currentGrossIncome) * 100) / 100,
        vacancyLoss: Math.round((isStubYear ? appliedVacancy : vacancyLoss) * 100) / 100,
        effectiveGrossIncome: Math.round((isStubYear ? appliedEGI : effectiveGrossIncome) * 100) / 100,
        operatingExpenses: Math.round((isStubYear ? appliedOpex : operatingExpenses) * 100) / 100,
        netOperatingIncome: Math.round((isStubYear ? appliedNOI : netOperatingIncome) * 100) / 100,
        debtService: Math.round(currentDebtService * 100) / 100,
        annualDebtService: Math.round(currentDebtService * 100) / 100,
        principalPaid: Math.round(principalPaid * 100) / 100,
        interestPaid: Math.round(interestPaid * 100) / 100,
        cumulativePrincipalPaid: Math.round(cumulativePrincipalPaid * 100) / 100,
        appliedInterestRate: yearAmort.appliedRate ?? interestRate,
        isInterestOnly: !!yearAmort.isInterestOnly,
        isArmAdjusted: !!yearAmort.isArmAdjusted,
        financingType: finOptions.financingType,
        capexReserve: Math.round((isStubYear ? appliedCapex : capexReserve) * 100) / 100,
        cashFlow: Math.round(cashFlow * 100) / 100,
        netCashFlow: Math.round(cashFlow * 100) / 100,
        cashInjection: Math.round(cashInjection * 100) / 100,
        cumulativeCashInvested: Math.round(cumulativeCashInvested * 100) / 100,
        cashOnCash: Math.round(cashOnCash * 100) / 100,
        cashOnCashDisplay,
        isCoCNotMeaningful,
        capRate: Math.round(capRate * 100) / 100,
        loanBalanceRemaining: Math.round(remainingLoanBalance * 100) / 100,
        endingDebt: Math.round(remainingLoanBalance * 100) / 100,
        remainingLoanBalance: Math.round(remainingLoanBalance * 100) / 100,
        equity: Math.round(equity * 100) / 100,
        dscr: dscr !== null ? Math.round(dscr * 100) / 100 : null,
        debtYield: debtYield !== null ? Math.round(debtYield * 100) / 100 : null,
        ltv: Math.round(ltv * 100) / 100,
        isStubYear,
        operatingMonths
      });
    }
    const discountRate = isNaN(parseFloat(inputs.discountRate)) ? 8 : parseFloat(inputs.discountRate);
    let npv = -initialCashInvested;
    for (let t = 1; t <= exitYear; t++) {
      let cf = projections[t - 1].cashFlow;
      if (t === exitYear) {
        cf += projections[t - 1].equity;
      }
      npv += cf / Math.pow(1 + discountRate / 100, t);
    }
    const irrCashFlows = [];
    for (let t = 1; t <= exitYear; t++) {
      let cf = projections[t - 1].cashFlow;
      if (t === exitYear) {
        cf += projections[t - 1].equity;
      }
      irrCashFlows.push(cf);
    }
    const irr = calculateIRR(initialCashInvested, irrCashFlows);
    let totalReturned = 0;
    let totalInvested = initialCashInvested;
    for (let t = 1; t <= exitYear; t++) {
      const cf = projections[t - 1].cashFlow;
      if (cf < 0) {
        totalInvested += Math.abs(cf);
      } else {
        totalReturned += cf;
      }
    }
    totalReturned += projections[exitYear - 1].equity;
    const equityMultiplier = totalInvested > 0 ? totalReturned / totalInvested : 0;
    let cumulativeCash = -initialCashInvested;
    let breakEvenYear = "N/A";
    if (cumulativeCash >= 0) {
      breakEvenYear = 0;
    } else {
      for (let t = 1; t <= projections.length; t++) {
        cumulativeCash += projections[t - 1].cashFlow;
        if (cumulativeCash >= 0) {
          breakEvenYear = t;
          break;
        }
      }
    }
    const acquisitionLtv = purchasePrice > 0 ? loanAmount / purchasePrice * 100 : 0;
    const isZeroEquity = initialCashInvested <= 0 && purchasePrice > 0;
    const irrDisplay = isZeroEquity ? "N/M (100% Financed)" : (Math.round(irr * 100) / 100).toFixed(2) + "%";
    const equityMultiplierDisplay = isZeroEquity ? "N/M (Zero Initial Outlay)" : (Math.round(equityMultiplier * 100) / 100).toFixed(2) + "x";
    const y1CoCDisplay = projections[0] ? projections[0].cashOnCashDisplay : "0.00%";
    return {
      isZeroEquity,
      financingType: finOptions.financingType,
      interestOnlyYears: finOptions.interestOnlyYears,
      armInitialYears: finOptions.armInitialYears,
      armAdjustmentRate: finOptions.armAdjustmentRate,
      armRateCap: finOptions.armRateCap,
      irrDisplay,
      equityMultiplierDisplay,
      cashOnCashDisplay: y1CoCDisplay,
      purchasePrice: Math.round(purchasePrice * 100) / 100,
      downPaymentAmount: Math.round(downPaymentAmount * 100) / 100,
      loanAmount: Math.max(0, Math.round(loanAmount * 100) / 100),
      initialCashInvested: Math.round(initialCashInvested * 100) / 100,
      initialEquity: Math.round(initialEquity * 100) / 100,
      annualDebtService: Math.round(annualDebtService * 100) / 100,
      npv: Math.round(npv * 100) / 100,
      irr: Math.round(irr * 100) / 100,
      equityMultiplier: Math.round(equityMultiplier * 100) / 100,
      equity_multiple: Math.round(equityMultiplier * 100) / 100,
      cash_on_cash: projections[0] ? projections[0].cashOnCash : 0,
      year1_cashflow: projections[0] ? projections[0].cashFlow : 0,
      year1Cashflow: projections[0] ? projections[0].cashFlow : 0,
      total_equity: Math.round(initialCashInvested * 100) / 100,
      breakEvenYear,
      ltv: Math.round(acquisitionLtv * 100) / 100,
      monthlyMortgagePayment: Math.round(monthlyPayment * 100) / 100,
      amortizationSchedule,
      projections,
      isProratedFirstYear: isProrateFirstYear,
      firstYearOperatingMonths: isProrateFirstYear ? firstYearOperatingMonths : 12
    };
  }
  function calculateMonthlyProjections(assetType, inputs, options = {}) {
    const rawDate = inputs.closingDate || options.closingDate || options.startDate || "2026-10-01";
    let startYear = 2026;
    let startMonth = 10;
    if (rawDate) {
      const parts = String(rawDate).split(/[-/]/);
      if (parts.length >= 2) {
        if (parts[0].length === 4) {
          startYear = parseInt(parts[0], 10);
          startMonth = parseInt(parts[1], 10);
        } else {
          startMonth = parseInt(parts[0], 10);
          startYear = parseInt(parts[2] || parts[1], 10);
        }
      }
    }
    let monthsCount = 24;
    const hasExplicitMonths = options.totalMonths !== void 0 || options.monthsCount !== void 0;
    const rawEnd = options.endDate || (!hasExplicitMonths ? inputs.monthlyEndDate || options.targetEndDate : null);
    if (rawEnd) {
      let endYear = null;
      let endMonth = null;
      if (rawEnd instanceof Date && !isNaN(rawEnd.getTime())) {
        endYear = rawEnd.getFullYear();
        endMonth = rawEnd.getMonth() + 1;
      } else {
        const strEnd = String(rawEnd).trim();
        const parts = strEnd.split(/[-/]/);
        if (parts.length >= 2) {
          if (parts[0].length === 4) {
            endYear = parseInt(parts[0], 10);
            endMonth = parseInt(parts[1], 10);
          } else {
            endMonth = parseInt(parts[0], 10);
            endYear = parseInt(parts[2] || parts[1], 10);
          }
        }
      }
      if (endYear && endMonth && !isNaN(endYear) && !isNaN(endMonth)) {
        const diffMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
        if (!isNaN(diffMonths) && diffMonths > 0) {
          monthsCount = Math.min(360, Math.max(1, diffMonths));
        }
      }
    } else if (options.monthsCount !== void 0 || options.totalMonths !== void 0 || inputs.monthlyTotalMonths !== void 0) {
      const rawCount = parseInt(options.monthsCount !== void 0 ? options.monthsCount : options.totalMonths !== void 0 ? options.totalMonths : inputs.monthlyTotalMonths, 10);
      if (!isNaN(rawCount) && rawCount > 0) {
        monthsCount = Math.min(360, Math.max(1, rawCount));
      }
    }
    const requiredYears = Math.min(30, Math.max(10, Math.ceil(monthsCount / 12)));
    const annualBase = calculateProjections(assetType, { ...inputs, holdingPeriod: requiredYears, exitYear: requiredYears, prorateFirstYear: false });
    const purchasePrice = annualBase.purchasePrice;
    const loanAmount = annualBase.loanAmount !== void 0 ? annualBase.loanAmount : Math.max(0, purchasePrice - purchasePrice * (parseFloat(inputs.downPaymentPercent || 25) / 100));
    const interestRate = parseFloat(inputs.interestRate) || 6.5;
    const loanTerm = parseInt(inputs.loanTerm) || 30;
    const finOptions = {
      financingType: inputs.financingType || "fixed",
      armInitialYears: inputs.armInitialYears ?? 5,
      armAdjustmentRate: inputs.armAdjustmentRate,
      armRateCap: inputs.armRateCap,
      interestOnlyYears: inputs.interestOnlyYears,
      totalMonths: monthsCount
    };
    const monthlyAmort = getMonthlyAmortization(loanAmount, interestRate, loanTerm, finOptions);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyRows = [];
    let cumulativeCash = 0;
    for (let m = 1; m <= monthsCount; m++) {
      const month0 = (startMonth - 1 + (m - 1)) % 12;
      const calYear = startYear + Math.floor((startMonth - 1 + (m - 1)) / 12);
      const calMonthName = monthNames[month0];
      const monthLabel = `${calMonthName} ${calYear}`;
      const opYear = Math.floor((m - 1) / 12) + 1;
      const yearProj = annualBase.projections[Math.min(opYear - 1, annualBase.projections.length - 1)] || {};
      const monthlyGross = (yearProj.grossPotentialIncome || 0) / 12;
      const monthlyVacancy = (yearProj.vacancyLoss || 0) / 12;
      const monthlyEGI = monthlyGross - monthlyVacancy;
      const monthlyOpex = (yearProj.operatingExpenses || 0) / 12;
      const monthlyNOI = monthlyEGI - monthlyOpex;
      const amort = monthlyAmort[m - 1] || {};
      const debtPayment = amort.payment || 0;
      const principalPaid = amort.principalPaid || 0;
      const interestPaid = amort.interestPaid || 0;
      const endingLoanBal = amort.endingBalance !== void 0 ? amort.endingBalance : 0;
      const netCashFlow = monthlyNOI - debtPayment;
      cumulativeCash += netCashFlow;
      monthlyRows.push({
        monthNumber: m,
        calendarYear: calYear,
        calendarMonth: month0 + 1,
        calendarMonthName: calMonthName,
        label: monthLabel,
        operatingYear: opYear,
        grossIncome: Math.round(monthlyGross * 100) / 100,
        vacancyLoss: Math.round(monthlyVacancy * 100) / 100,
        effectiveGrossIncome: Math.round(monthlyEGI * 100) / 100,
        operatingExpenses: Math.round(monthlyOpex * 100) / 100,
        netOperatingIncome: Math.round(monthlyNOI * 100) / 100,
        debtService: Math.round(debtPayment * 100) / 100,
        principalPaid: Math.round(principalPaid * 100) / 100,
        interestPaid: Math.round(interestPaid * 100) / 100,
        netCashFlow: Math.round(netCashFlow * 100) / 100,
        cashFlow: Math.round(netCashFlow * 100) / 100,
        cumulativeCashFlow: Math.round(cumulativeCash * 100) / 100,
        remainingLoanBalance: Math.round(endingLoanBal * 100) / 100
      });
    }
    const endCalYear = startYear + Math.floor((startMonth - 1 + (monthsCount - 1)) / 12);
    const endCalMonth0 = (startMonth - 1 + (monthsCount - 1)) % 12;
    const endMonthName = monthNames[endCalMonth0];
    return {
      startYear,
      startMonth,
      startMonthName: monthNames[startMonth - 1],
      startDateISO: `${startYear}-${String(startMonth).padStart(2, "0")}`,
      endYear: endCalYear,
      endMonth: endCalMonth0 + 1,
      endMonthName,
      endDateISO: `${endCalYear}-${String(endCalMonth0 + 1).padStart(2, "0")}`,
      totalMonths: monthsCount,
      monthlyProjections: monthlyRows,
      summary: {
        totalGrossIncome: Math.round(monthlyRows.reduce((sum, r) => sum + (r.grossIncome || 0), 0) * 100) / 100,
        totalNOI: Math.round(monthlyRows.reduce((sum, r) => sum + (r.netOperatingIncome || 0), 0) * 100) / 100,
        totalDebtService: Math.round(monthlyRows.reduce((sum, r) => sum + (r.debtService || 0), 0) * 100) / 100,
        totalPrincipalPaid: Math.round(monthlyRows.reduce((sum, r) => sum + (r.principalPaid || 0), 0) * 100) / 100,
        totalInterestPaid: Math.round(monthlyRows.reduce((sum, r) => sum + (r.interestPaid || 0), 0) * 100) / 100,
        netCumulativeCashFlow: Math.round(cumulativeCash * 100) / 100,
        endingLoanBalance: monthlyRows.length > 0 ? monthlyRows[monthlyRows.length - 1].remainingLoanBalance : 0
      }
    };
  }
  function calculateSensitivityMatrix(assetType, baseInputs, rowParam = "exitCapRate", rowValues = [5.5, 6, 6.5, 7, 7.5], colParam = "vacancyRate", colValues = [0, 3, 5, 8, 10]) {
    const matrix = [];
    for (let r = 0; r < rowValues.length; r++) {
      const rowVal = rowValues[r];
      const rowCells = [];
      for (let c = 0; c < colValues.length; c++) {
        const colVal = colValues[c];
        const testInputs = {
          ...baseInputs,
          [rowParam]: rowVal,
          [colParam]: colVal
        };
        const res = calculateProjections(assetType, testInputs);
        rowCells.push({
          rowValue: rowVal,
          colValue: colVal,
          irr: res.irr,
          npv: res.npv,
          cashOnCashY1: res.projections[0] ? res.projections[0].cashOnCash : 0,
          cashFlowY1: res.projections[0] ? res.projections[0].cashFlow : 0,
          equityMultiplier: res.equityMultiplier
        });
      }
      matrix.push(rowCells);
    }
    return {
      rowParam,
      rowValues,
      colParam,
      colValues,
      matrix
    };
  }
  function gaussianRandom(mean = 0, stdDev = 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const num = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + num * stdDev;
  }
  function buildAdaptiveHistogramBins(sortedIrrs, targetBinCount = 10) {
    if (!sortedIrrs || sortedIrrs.length === 0) return [];
    const n2 = sortedIrrs.length;
    if (n2 <= targetBinCount) {
      return sortedIrrs.map((val) => {
        const rounded = Math.round(val * 10) / 10;
        return {
          label: `${rounded}%`,
          binStart: rounded,
          binEnd: rounded,
          count: 1,
          isTail: false
        };
      });
    }
    const p5Idx = Math.floor(n2 * 0.05);
    const p95Idx = Math.floor(n2 * 0.95);
    const coreIrrs = sortedIrrs.slice(p5Idx, p95Idx);
    const minCore = coreIrrs[0];
    const maxCore = coreIrrs[coreIrrs.length - 1];
    let effectiveMinCore = minCore;
    let effectiveMaxCore = maxCore;
    if (effectiveMaxCore - effectiveMinCore < 1) {
      const center = (effectiveMaxCore + effectiveMinCore) / 2;
      effectiveMinCore = center - 2.5;
      effectiveMaxCore = center + 2.5;
    }
    const coreBinCount = targetBinCount - 2;
    const binStep = (effectiveMaxCore - effectiveMinCore) / coreBinCount;
    const bins = [];
    bins.push({
      label: `< ${effectiveMinCore.toFixed(1)}%`,
      binStart: sortedIrrs[0],
      binEnd: effectiveMinCore,
      count: sortedIrrs.filter((val) => val < effectiveMinCore).length,
      isTail: true
    });
    for (let i = 0; i < coreBinCount; i++) {
      const bStart = effectiveMinCore + i * binStep;
      const bEnd = i === coreBinCount - 1 ? effectiveMaxCore : bStart + binStep;
      const count = sortedIrrs.filter((val) => val >= bStart && (i === coreBinCount - 1 ? val <= bEnd : val < bEnd)).length;
      const rStart = Math.round(bStart * 10) / 10;
      const rEnd = Math.round(bEnd * 10) / 10;
      const label = rStart === rEnd ? `${bStart.toFixed(2)}% to ${bEnd.toFixed(2)}%` : `${rStart}% to ${rEnd}%`;
      bins.push({
        label,
        binStart: bStart,
        binEnd: bEnd,
        count,
        isTail: false
      });
    }
    bins.push({
      label: `> ${effectiveMaxCore.toFixed(1)}%`,
      binStart: effectiveMaxCore,
      binEnd: sortedIrrs[n2 - 1],
      count: sortedIrrs.filter((val) => val > effectiveMaxCore).length,
      isTail: true
    });
    return bins;
  }
  function runMonteCarloSimulation(assetType, baseInputs, iterations = 500) {
    const irrs = [];
    const npvs = [];
    let negativeCashFlowCount = 0;
    let negativeIrrCount = 0;
    const baseRentGrowth = parseFloat(baseInputs.rentGrowth) || 3;
    const baseVacancy = parseFloat(baseInputs.vacancyRate) || 5;
    const baseExitCap = parseFloat(baseInputs.targetCapRate || baseInputs.targetExitCapRate || 6.5);
    const baseApprec = parseFloat(baseInputs.appreciationRate) || 3;
    const isCommercialOrStorage = assetType === "commercial" || assetType === "storage";
    const growthStdDev = 1.2;
    const vacancyStdDev = 2;
    const exitCapSpreadPct = 0.8;
    const apprecStdDev = 1.5;
    for (let i = 0; i < iterations; i++) {
      const simRentGrowth = Math.max(-10, gaussianRandom(baseRentGrowth, growthStdDev));
      const simVacancy = Math.max(0, Math.min(30, gaussianRandom(baseVacancy, vacancyStdDev)));
      const simExitCap = Math.max(2.5, gaussianRandom(baseExitCap, exitCapSpreadPct));
      const simApprec = Math.max(-15, gaussianRandom(baseApprec, apprecStdDev));
      const simInputs = {
        ...baseInputs,
        rentGrowth: simRentGrowth,
        vacancyRate: simVacancy,
        targetCapRate: simExitCap,
        targetExitCapRate: simExitCap,
        appreciationRate: simApprec
      };
      const res = calculateProjections(assetType, simInputs);
      irrs.push(res.irr);
      npvs.push(res.npv);
      if (res.projections && res.projections.some((p) => p.cashFlow < 0)) {
        negativeCashFlowCount++;
      }
      if (res.irr < 0) {
        negativeIrrCount++;
      }
    }
    irrs.sort((a, b) => a - b);
    const meanIrr = irrs.reduce((a, b) => a + b, 0) / iterations;
    const medianIrr = irrs[Math.floor(iterations * 0.5)];
    const p5Irr = irrs[Math.floor(iterations * 0.05)];
    const p95Irr = irrs[Math.floor(iterations * 0.95)];
    const meanNpv = npvs.reduce((a, b) => a + b, 0) / iterations;
    const bins = buildAdaptiveHistogramBins(irrs, 10);
    const variance = irrs.reduce((acc, val) => acc + Math.pow(val - meanIrr, 2), 0) / iterations;
    const stdDev = Math.sqrt(variance);
    const skewnessIndex = stdDev > 0 ? (meanIrr - medianIrr) / stdDev : 0;
    const riskFreeRate = 4;
    const sharpeRatio = stdDev > 0 ? (meanIrr - riskFreeRate) / stdDev : 0;
    let riskClassification = "Conservative / Low Tail Risk";
    if (p5Irr < 4 && p5Irr >= 0) {
      riskClassification = "Moderate Cyclical Sensitivity";
    } else if (p5Irr < 0) {
      riskClassification = "High Leverage / Asymmetric Tail Risk Vulnerable";
    } else if (negativeCashFlowCount / iterations * 100 > 15) {
      riskClassification = "Capital Call Vulnerable (Operating Cash Flow Risk)";
    }
    return {
      iterations,
      meanIrr: Math.round(meanIrr * 100) / 100,
      medianIrr: Math.round(medianIrr * 100) / 100,
      p5Irr: Math.round(p5Irr * 100) / 100,
      p95Irr: Math.round(p95Irr * 100) / 100,
      meanNpv: Math.round(meanNpv * 100) / 100,
      probNegativeCashFlow: Math.round(negativeCashFlowCount / iterations * 1e3) / 10,
      probNegativeIrr: Math.round(negativeIrrCount / iterations * 1e3) / 10,
      skewnessIndex,
      sharpeRatio,
      riskClassification,
      histogramBins: bins,
      telemetry: {
        baselineRentGrowth: baseRentGrowth,
        baselineVacancy: baseVacancy,
        baselineExitMetric: isCommercialOrStorage ? baseExitCap : baseApprec,
        exitMetricType: isCommercialOrStorage ? "Exit Cap Rate" : "Annual Appreciation"
      }
    };
  }
  function calculateTaxAndDepreciation(assetType, inputs, baseResults) {
    const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
    const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
    const landPercent = parseFloat(inputs.landPercent) || 20;
    const taxRate = parseFloat(inputs.taxRate) || 24;
    const enableCostSeg = inputs.enableCostSeg === true || inputs.enableCostSeg === "true";
    const landValue = purchasePrice * (landPercent / 100);
    const totalDepreciableBasis = Math.max(0, purchasePrice - landValue + rehabCosts);
    const recoveryPeriod = assetType === "single-family" || assetType === "multi-unit" ? 27.5 : 39;
    let annualDepreciation = totalDepreciableBasis / recoveryPeriod;
    let year1Depreciation = annualDepreciation;
    if (enableCostSeg) {
      const bonusBasis = totalDepreciableBasis * 0.15;
      const remainingBasis = totalDepreciableBasis * 0.85;
      const bonusYr1 = bonusBasis * 0.8;
      const straightLineYr1 = remainingBasis / recoveryPeriod;
      year1Depreciation = bonusYr1 + straightLineYr1;
    }
    const numYears = baseResults && baseResults.projections ? baseResults.projections.length : Math.max(1, Math.min(30, parseInt(inputs.holdingPeriod || inputs.exitYear || inputs.holdYears || 10, 10)));
    const yearlyTaxDetails = [];
    const afterTaxCashFlows = [];
    let accumDepreciation = 0;
    for (let year = 1; year <= numYears; year++) {
      const proj = baseResults.projections[year - 1] || {};
      const amort = baseResults.amortizationSchedule && baseResults.amortizationSchedule[year - 1] || {};
      const interestExpense = amort ? amort.interestPaid || 0 : 0;
      let depForYear = year === 1 && enableCostSeg ? year1Depreciation : annualDepreciation;
      if (accumDepreciation + depForYear > totalDepreciableBasis) {
        depForYear = Math.max(0, totalDepreciableBasis - accumDepreciation);
      }
      accumDepreciation += depForYear;
      const noi = proj.netOperatingIncome || 0;
      const cf = proj.cashFlow !== void 0 ? proj.cashFlow : noi - (amort.totalPayment || 0);
      const taxableIncome = noi - interestExpense - depForYear;
      const taxLiability = taxableIncome * (taxRate / 100);
      const afterTaxCashFlow = cf - taxLiability;
      afterTaxCashFlows.push(afterTaxCashFlow);
      yearlyTaxDetails.push({
        year,
        noi,
        interestExpense: Math.round(interestExpense * 100) / 100,
        depreciation: Math.round(depForYear * 100) / 100,
        taxableIncome: Math.round(taxableIncome * 100) / 100,
        taxLiability: Math.round(taxLiability * 100) / 100,
        preTaxCashFlow: cf,
        afterTaxCashFlow: Math.round(afterTaxCashFlow * 100) / 100
      });
    }
    const rawExitYear = parseInt(inputs.exitYear !== void 0 ? inputs.exitYear : inputs.holdingPeriod !== void 0 ? inputs.holdingPeriod : inputs.holdYears);
    const exitYear = Math.max(1, Math.min(numYears, isNaN(rawExitYear) ? numYears : rawExitYear));
    const exitProj = baseResults.projections[exitYear - 1];
    const exitValue = exitProj ? exitProj.propertyValue : purchasePrice;
    const exitLoanBalance = exitProj ? exitProj.loanBalanceRemaining : 0;
    const adjustedBasis = Math.max(0, purchasePrice + rehabCosts - accumDepreciation);
    const totalGain = Math.max(0, exitValue - adjustedBasis);
    const depRecaptureTax = accumDepreciation * 0.25;
    const capitalGainTaxable = Math.max(0, totalGain - accumDepreciation);
    const capitalGainsTax = capitalGainTaxable * 0.15;
    const totalExitTax = depRecaptureTax + capitalGainsTax;
    const preTaxNetSaleProceeds = exitValue - exitLoanBalance;
    const afterTaxNetSaleProceeds = Math.max(0, preTaxNetSaleProceeds - totalExitTax);
    const afterTaxIrrFlows = [];
    for (let t = 1; t <= exitYear; t++) {
      let cf = yearlyTaxDetails[t - 1].afterTaxCashFlow;
      if (t === exitYear) {
        cf += afterTaxNetSaleProceeds;
      }
      afterTaxIrrFlows.push(cf);
    }
    const afterTaxIrr = calculateIRR(baseResults.initialCashInvested, afterTaxIrrFlows);
    return {
      depreciableBasis: Math.round(totalDepreciableBasis * 100) / 100,
      recoveryPeriod,
      annualDepreciation: Math.round(annualDepreciation * 100) / 100,
      accumulatedDepreciation: Math.round(accumDepreciation * 100) / 100,
      afterTaxIrr: Math.round(afterTaxIrr * 100) / 100,
      afterTaxCoCY1: yearlyTaxDetails[0] && baseResults.initialCashInvested > 0 ? Math.round(yearlyTaxDetails[0].afterTaxCashFlow / baseResults.initialCashInvested * 1e4) / 100 : 0,
      totalExitTax: Math.round(totalExitTax * 100) / 100,
      afterTaxNetSaleProceeds: Math.round(afterTaxNetSaleProceeds * 100) / 100,
      yearlyTaxDetails
    };
  }
  function calculateTaxMetrics(assetClass, inputs) {
    const baseRes = calculateProjections(assetClass, inputs);
    const tax = calculateTaxAndDepreciation(assetClass, inputs, baseRes);
    const landAllocationPct = parseFloat(String(inputs.landPercent || 20)) || 20;
    const effectiveTaxRate = parseFloat(String(inputs.taxRate || 24)) || 24;
    return {
      depYears: assetClass === "single-family" || assetClass === "multi-unit" ? 27.5 : 39,
      depreciableBasis: tax.depreciableBasis,
      annualDepreciation: tax.annualDepreciation,
      annualTaxShield: Math.round(tax.annualDepreciation * (effectiveTaxRate / 100)),
      landAllocationPct,
      effectiveTaxRate
    };
  }
  function calculateRefinanceEvent(assetType, baseInputs, refiYear = 3, refiLtv = 75, refiRate = 6.5, refiTerm = 30) {
    const baseRes = calculateProjections(assetType, baseInputs);
    const targetYear = Math.max(1, Math.min(9, parseInt(String(refiYear)) || 3));
    const projAtRefi = baseRes.projections[targetYear - 1];
    if (!projAtRefi) return baseRes;
    const refiValue = projAtRefi.propertyValue;
    const newLoanAmount = refiValue * (refiLtv / 100);
    const oldLoanBalance = projAtRefi.loanBalanceRemaining;
    const refiClosingCosts = newLoanAmount * 0.02;
    const netCashOut = newLoanAmount - oldLoanBalance - refiClosingCosts;
    const newMonthlyPayment = calculateMonthlyPayment(newLoanAmount, refiRate, refiTerm);
    const newAnnualDebtService = newMonthlyPayment * 12;
    const updatedProjections = JSON.parse(JSON.stringify(baseRes.projections));
    let updatedCashInvested = baseRes.initialCashInvested;
    for (let y = 1; y <= updatedProjections.length; y++) {
      const p = updatedProjections[y - 1];
      if (y === targetYear) {
        p.refiProceeds = Math.round(netCashOut * 100) / 100;
        p.cashFlow = Math.round((p.cashFlow + netCashOut) * 100) / 100;
        updatedCashInvested = Math.max(0, updatedCashInvested - netCashOut);
      } else if (y > targetYear) {
        p.debtService = Math.round(newAnnualDebtService * 100) / 100;
        p.netOperatingIncome = p.effectiveGrossIncome - p.operatingExpenses;
        p.cashFlow = Math.round((p.netOperatingIncome - p.debtService) * 100) / 100;
        const newBalance = calculateRemainingBalance(newLoanAmount, refiRate, refiTerm, y - targetYear);
        p.loanBalanceRemaining = Math.round(newBalance * 100) / 100;
        p.equity = Math.round((p.propertyValue - newBalance) * 100) / 100;
        p.dscr = p.debtService > 0 ? Math.round(p.netOperatingIncome / p.debtService * 100) / 100 : null;
      }
    }
    const exitYear = baseRes.projections.length;
    const irrFlows = [];
    for (let t = 1; t <= exitYear; t++) {
      let cf = updatedProjections[t - 1].cashFlow;
      if (t === exitYear) {
        cf += updatedProjections[t - 1].equity;
      }
      irrFlows.push(cf);
    }
    const refiIrr = calculateIRR(baseRes.initialCashInvested, irrFlows);
    return {
      refiYear: targetYear,
      refiValue: Math.round(refiValue * 100) / 100,
      newLoanAmount: Math.round(newLoanAmount * 100) / 100,
      oldLoanBalance: Math.round(oldLoanBalance * 100) / 100,
      netCashOut: Math.round(netCashOut * 100) / 100,
      newAnnualDebtService: Math.round(newAnnualDebtService * 100) / 100,
      remainingCapitalInDeal: Math.round(updatedCashInvested * 100) / 100,
      refiIrr: Math.round(refiIrr * 100) / 100,
      projections: updatedProjections
    };
  }
  function solveTargetPurchasePrice(assetType, baseInputs, targetIRR = 15) {
    let lowPrice = 1e4;
    let highPrice = 5e7;
    let bestPrice = parseFloat(baseInputs.purchasePrice) || 2e5;
    for (let i = 0; i < 50; i++) {
      const midPrice = (lowPrice + highPrice) / 2;
      const testInputs = { ...baseInputs, purchasePrice: midPrice };
      const res = calculateProjections(assetType, testInputs);
      if (Math.abs(res.irr - targetIRR) < 0.05) {
        bestPrice = midPrice;
        break;
      }
      if (res.irr > targetIRR) {
        lowPrice = midPrice;
      } else {
        highPrice = midPrice;
      }
      bestPrice = midPrice;
    }
    const solvedResults = calculateProjections(assetType, { ...baseInputs, purchasePrice: Math.round(bestPrice) });
    return {
      targetIRR,
      solvedPurchasePrice: Math.round(bestPrice),
      solvedResults
    };
  }
  function generateScenarioVariants(assetType, baseInputs) {
    const base = { ...baseInputs };
    const bull = { ...baseInputs };
    if (bull.monthlyRent) bull.monthlyRent = Math.round(parseFloat(bull.monthlyRent) * 1.08);
    if (bull.grossRentMonthly) bull.grossRentMonthly = Math.round(parseFloat(bull.grossRentMonthly) * 1.08);
    if (bull.monthlyRentPerUnit) bull.monthlyRentPerUnit = Math.round(parseFloat(bull.monthlyRentPerUnit) * 1.08);
    if (bull.rentPerSqFt) bull.rentPerSqFt = Math.round(parseFloat(bull.rentPerSqFt) * 1.08 * 100) / 100;
    if (bull.vacancyRate) bull.vacancyRate = Math.max(1, Math.round((parseFloat(bull.vacancyRate) - 1.5) * 10) / 10);
    if (bull.rentGrowthRate) bull.rentGrowthRate = Math.round((parseFloat(bull.rentGrowthRate) + 0.5) * 10) / 10;
    if (bull.appreciationRate) bull.appreciationRate = Math.round((parseFloat(bull.appreciationRate) + 0.5) * 10) / 10;
    const bear = { ...baseInputs };
    if (bear.monthlyRent) bear.monthlyRent = Math.round(parseFloat(bear.monthlyRent) * 0.92);
    if (bear.grossRentMonthly) bear.grossRentMonthly = Math.round(parseFloat(bear.grossRentMonthly) * 0.92);
    if (bear.monthlyRentPerUnit) bear.monthlyRentPerUnit = Math.round(parseFloat(bear.monthlyRentPerUnit) * 0.92);
    if (bear.rentPerSqFt) bear.rentPerSqFt = Math.round(parseFloat(bear.rentPerSqFt) * 0.92 * 100) / 100;
    if (bear.vacancyRate) bear.vacancyRate = Math.min(25, Math.round((parseFloat(bear.vacancyRate) + 3) * 10) / 10);
    if (bear.rentGrowthRate) bear.rentGrowthRate = Math.max(0, Math.round((parseFloat(bear.rentGrowthRate) - 0.75) * 10) / 10);
    if (bear.interestRate) bear.interestRate = Math.round((parseFloat(bear.interestRate) + 0.5) * 100) / 100;
    return {
      base: { inputs: base, results: calculateProjections(assetType, base) },
      bull: { inputs: bull, results: calculateProjections(assetType, bull) },
      bear: { inputs: bear, results: calculateProjections(assetType, bear) }
    };
  }
  function aggregatePortfolio(dealsList) {
    if (!dealsList || dealsList.length === 0) {
      return {
        dealCount: 0,
        totalPurchasePrice: 0,
        totalCashInvested: 0,
        totalLoanAmount: 0,
        portfolioIrr: 0,
        combinedProjections: []
      };
    }
    let totalPurchasePrice = 0;
    let totalCashInvested = 0;
    let totalLoanAmount = 0;
    let totalUnitsOrDoors = 0;
    let maxHold = 10;
    dealsList.forEach((deal) => {
      const hold = parseInt(deal.inputs?.holdingPeriod || deal.inputs?.exitYear || deal.inputs?.holdYears || 10, 10);
      if (!isNaN(hold) && hold > maxHold) maxHold = Math.min(30, hold);
      if (deal.results && deal.results.projections && deal.results.projections.length > maxHold) {
        maxHold = Math.min(30, deal.results.projections.length);
      }
    });
    const combinedProjections = [];
    for (let year = 1; year <= maxHold; year++) {
      combinedProjections.push({
        year,
        propertyValue: 0,
        grossPotentialIncome: 0,
        effectiveGrossIncome: 0,
        operatingExpenses: 0,
        netOperatingIncome: 0,
        debtService: 0,
        cashFlow: 0,
        netCashFlow: 0,
        equity: 0
      });
    }
    const portfolioIrrFlows = [];
    for (let year = 1; year <= maxHold; year++) {
      portfolioIrrFlows.push(0);
    }
    dealsList.forEach((deal) => {
      const qty = typeof deal.quantity === "number" && deal.quantity > 0 ? deal.quantity : 1;
      totalUnitsOrDoors += qty;
      const res = deal.results || calculateProjections(deal.assetType || deal.asset_class || "commercial", deal.inputs);
      totalPurchasePrice += res.purchasePrice * qty;
      totalCashInvested += res.initialCashInvested * qty;
      totalLoanAmount += res.loanAmount * qty;
      res.projections.forEach((p, idx) => {
        if (combinedProjections[idx]) {
          combinedProjections[idx].propertyValue += p.propertyValue * qty;
          combinedProjections[idx].grossPotentialIncome += p.grossPotentialIncome * qty;
          combinedProjections[idx].effectiveGrossIncome += p.effectiveGrossIncome * qty;
          combinedProjections[idx].operatingExpenses += p.operatingExpenses * qty;
          combinedProjections[idx].netOperatingIncome += p.netOperatingIncome * qty;
          combinedProjections[idx].debtService += p.debtService * qty;
          combinedProjections[idx].cashFlow += p.cashFlow * qty;
          combinedProjections[idx].equity += p.equity * qty;
          portfolioIrrFlows[idx] += p.cashFlow * qty + (idx === maxHold - 1 ? p.equity * qty : 0);
        }
      });
    });
    let cumulativeCashFlow = 0;
    combinedProjections.forEach((cp) => {
      cp.propertyValue = Math.round(cp.propertyValue * 100) / 100;
      cp.grossPotentialIncome = Math.round(cp.grossPotentialIncome * 100) / 100;
      cp.effectiveGrossIncome = Math.round(cp.effectiveGrossIncome * 100) / 100;
      cp.operatingExpenses = Math.round(cp.operatingExpenses * 100) / 100;
      cp.netOperatingIncome = Math.round(cp.netOperatingIncome * 100) / 100;
      cp.debtService = Math.round(cp.debtService * 100) / 100;
      cp.cashFlow = Math.round(cp.cashFlow * 100) / 100;
      cp.equity = Math.round(cp.equity * 100) / 100;
      cumulativeCashFlow += cp.cashFlow;
      cp.cumulativeCashFlow = Math.round(cumulativeCashFlow * 100) / 100;
      cp.dscr = cp.debtService > 0 ? Math.round(cp.netOperatingIncome / cp.debtService * 100) / 100 : null;
      cp.cashOnCash = totalCashInvested > 0 ? Math.round(cp.cashFlow / totalCashInvested * 1e4) / 100 : 0;
    });
    const portfolioIrr = calculateIRR(totalCashInvested, portfolioIrrFlows);
    const blendedYear1CoC = combinedProjections.length > 0 ? combinedProjections[0].cashOnCash : 0;
    const blendedYear1CapRate = totalPurchasePrice > 0 && combinedProjections.length > 0 ? Math.round(combinedProjections[0].netOperatingIncome / totalPurchasePrice * 1e4) / 100 : 0;
    const total10YearCashFlow = Math.round(cumulativeCashFlow * 100) / 100;
    const finalYearEquity = combinedProjections.length > 0 ? combinedProjections[combinedProjections.length - 1].equity : 0;
    const equityMultiple = totalCashInvested > 0 ? Math.round((total10YearCashFlow + finalYearEquity) / totalCashInvested * 100) / 100 : 0;
    const portfolioLtv = totalPurchasePrice > 0 ? Math.round(totalLoanAmount / totalPurchasePrice * 1e4) / 100 : 0;
    return {
      dealCount: dealsList.length,
      totalUnitsOrDoors,
      totalPurchasePrice: Math.round(totalPurchasePrice * 100) / 100,
      totalCashInvested: Math.round(totalCashInvested * 100) / 100,
      totalLoanAmount: Math.round(totalLoanAmount * 100) / 100,
      portfolioLtv,
      portfolioIrr: Math.round(portfolioIrr * 100) / 100,
      blendedYear1CoC,
      blendedYear1CapRate,
      total10YearCashFlow,
      equityMultiple,
      combinedProjections
    };
  }
  function getBenchmarkCapRateRange(assetType, marketTier = "Tier2", propertyClass = "ClassB", subType = "") {
    const tier = String(marketTier || "Tier2").replace(/[^a-zA-Z0-9]/g, "");
    const pClass = String(propertyClass || "ClassB").replace(/[^a-zA-Z0-9]/g, "");
    const sub = String(subType || "").toLowerCase();
    if (assetType === "commercial") {
      const isIndustrial = sub.includes("industrial") || sub.includes("logistics") || sub.includes("warehouse");
      const isOffice = sub.includes("office") || sub.includes("medical");
      if (isIndustrial) {
        if (tier.includes("1")) return pClass.includes("A") ? { min: 4.75, max: 5.5 } : pClass.includes("B") ? { min: 5.25, max: 6 } : { min: 6, max: 7 };
        if (tier.includes("2")) return pClass.includes("A") ? { min: 5.5, max: 6.25 } : pClass.includes("B") ? { min: 6, max: 6.75 } : { min: 6.75, max: 7.75 };
        return pClass.includes("A") ? { min: 6.25, max: 7 } : pClass.includes("B") ? { min: 6.75, max: 7.75 } : { min: 7.5, max: 8.75 };
      } else if (isOffice) {
        if (tier.includes("1")) return pClass.includes("A") ? { min: 6.25, max: 7.25 } : pClass.includes("B") ? { min: 7, max: 8 } : { min: 8, max: 9.5 };
        if (tier.includes("2")) return pClass.includes("A") ? { min: 7, max: 8 } : pClass.includes("B") ? { min: 7.75, max: 8.75 } : { min: 8.75, max: 10 };
        return pClass.includes("A") ? { min: 8, max: 9 } : pClass.includes("B") ? { min: 8.75, max: 9.75 } : { min: 9.5, max: 11 };
      } else {
        if (tier.includes("1")) return pClass.includes("A") ? { min: 5.75, max: 6.5 } : pClass.includes("B") ? { min: 6.25, max: 7.25 } : { min: 7, max: 8.25 };
        if (tier.includes("2")) return pClass.includes("A") ? { min: 6.5, max: 7.25 } : pClass.includes("B") ? { min: 7, max: 8 } : { min: 7.75, max: 9 };
        return pClass.includes("A") ? { min: 7.25, max: 8.25 } : pClass.includes("B") ? { min: 7.75, max: 8.75 } : { min: 8.5, max: 10 };
      }
    } else if (assetType === "multi-unit") {
      if (tier.includes("1")) return pClass.includes("A") ? { min: 4.5, max: 5.25 } : pClass.includes("B") ? { min: 5, max: 5.75 } : { min: 5.75, max: 6.5 };
      if (tier.includes("2")) return pClass.includes("A") ? { min: 5, max: 5.75 } : pClass.includes("B") ? { min: 5.5, max: 6.5 } : { min: 6.25, max: 7.25 };
      return pClass.includes("A") ? { min: 5.75, max: 6.75 } : pClass.includes("B") ? { min: 6.5, max: 7.5 } : { min: 7.25, max: 8.5 };
    } else if (assetType === "storage") {
      if (tier.includes("1")) return pClass.includes("A") ? { min: 5, max: 5.75 } : pClass.includes("B") ? { min: 5.5, max: 6.5 } : { min: 6.25, max: 7.25 };
      if (tier.includes("2")) return pClass.includes("A") ? { min: 5.75, max: 6.5 } : pClass.includes("B") ? { min: 6.25, max: 7.25 } : { min: 7, max: 8 };
      return pClass.includes("A") ? { min: 6.75, max: 7.75 } : pClass.includes("B") ? { min: 7.25, max: 8.25 } : { min: 7.75, max: 9 };
    } else {
      if (tier.includes("1")) return pClass.includes("A") ? { min: 4.5, max: 5.5 } : pClass.includes("B") ? { min: 5.25, max: 6.5 } : { min: 6, max: 7.25 };
      if (tier.includes("2")) return pClass.includes("A") ? { min: 5.25, max: 6.25 } : pClass.includes("B") ? { min: 6, max: 7.25 } : { min: 6.75, max: 8 };
      return pClass.includes("A") ? { min: 6, max: 7.25 } : pClass.includes("B") ? { min: 7, max: 8.5 } : { min: 7.5, max: 9.25 };
    }
  }
  function calculateHoldingPeriodWealth(inputs, projections, amortizationSchedule, holdYear = 1) {
    if (!projections || projections.length === 0) return null;
    const year = Math.max(1, Math.min(projections.length, parseInt(String(holdYear)) || 1));
    const yearIdx = year - 1;
    const proj = projections[yearIdx];
    const purchasePrice = parseFloat(inputs.purchasePrice) || 0;
    const downPaymentPercent = isNaN(parseFloat(inputs.downPaymentPercent)) ? 25 : parseFloat(inputs.downPaymentPercent);
    const downPaymentAmount = purchasePrice * (downPaymentPercent / 100);
    const rehabCosts = parseFloat(inputs.rehabCosts) || 0;
    const closingCosts = parseFloat(inputs.closingCosts) || 0;
    const rehabFinancingMode = inputs.rehabFinancingMode || (inputs.financeRehabAndClosingCosts ? "roll_into_loan" : "out_of_pocket");
    const isRehabFinanced = rehabFinancingMode === "roll_into_loan";
    const initialCashInvested = isRehabFinanced ? downPaymentAmount : downPaymentAmount + rehabCosts + closingCosts;
    const initialLoan = isRehabFinanced
      ? Math.max(0, purchasePrice - downPaymentAmount + rehabCosts + closingCosts)
      : Math.max(0, purchasePrice - downPaymentAmount);
    const currentPropertyValue = proj ? proj.propertyValue : purchasePrice;
    const remainingLoanBalance = proj ? proj.loanBalanceRemaining : initialLoan;
    const principalPaydownEquity = Math.max(0, initialLoan - remainingLoanBalance);
    const appreciationEquity = Math.max(0, currentPropertyValue - purchasePrice);
    const totalNetEquity = Math.max(0, currentPropertyValue - remainingLoanBalance);
    let cumulativeCashFlow = 0;
    for (let i = 0; i <= yearIdx; i++) {
      cumulativeCashFlow += projections[i] ? projections[i].cashFlow : 0;
    }
    const totalNetWealth = totalNetEquity + cumulativeCashFlow;
    const netProfit = totalNetWealth - initialCashInvested;
    const totalNetBenefit = totalNetWealth;
    const prevEquity = yearIdx === 0 ? initialCashInvested : projections[yearIdx - 1] ? projections[yearIdx - 1].equity : 0;
    const currentCashFlow = proj ? proj.cashFlow : 0;
    let roe = null;
    let roeDisplay = "N/M";
    if (prevEquity > 0) {
      roe = currentCashFlow / prevEquity * 100;
      roeDisplay = roe.toFixed(2) + "%";
    } else if (currentCashFlow > 0) {
      roeDisplay = "N/M (100% Financed)";
    }
    const discountRate = isNaN(parseFloat(inputs.discountRate)) ? 8 : parseFloat(inputs.discountRate);
    let holdNpv = -initialCashInvested;
    for (let t = 1; t <= year; t++) {
      let cf = projections[t - 1] ? projections[t - 1].cashFlow : 0;
      if (t === year) {
        cf += projections[t - 1] ? projections[t - 1].equity : 0;
      }
      holdNpv += cf / Math.pow(1 + discountRate / 100, t);
    }
    return {
      holdYear: year,
      propertyValue: Math.round(currentPropertyValue * 100) / 100,
      initialLoan: Math.round(initialLoan * 100) / 100,
      remainingLoanBalance: Math.round(remainingLoanBalance * 100) / 100,
      principalPaydownEquity: Math.round(principalPaydownEquity * 100) / 100,
      appreciationEquity: Math.round(appreciationEquity * 100) / 100,
      totalNetEquity: Math.round(totalNetEquity * 100) / 100,
      initialCashInvested: Math.round(initialCashInvested * 100) / 100,
      cumulativeCashFlow: Math.round(cumulativeCashFlow * 100) / 100,
      isDeficit: cumulativeCashFlow < 0,
      cashDeficit: cumulativeCashFlow < 0 ? Math.round(Math.abs(cumulativeCashFlow) * 100) / 100 : 0,
      totalNetBenefit: Math.round(totalNetBenefit * 100) / 100,
      totalNetWealth: Math.round(totalNetWealth * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      currentCashFlow: Math.round(currentCashFlow * 100) / 100,
      roe: roe !== null ? Math.round(roe * 100) / 100 : null,
      roeDisplay,
      holdNpv: Math.round(holdNpv * 100) / 100
    };
  }
  function auditDealRisks(assetType, inputs, results) {
    const warnings = [];
    if (!results || !results.projections || results.projections.length === 0) {
      return warnings;
    }
    const validDscrs = results.projections.filter((p) => p.dscr !== null).map((p) => p.dscr);
    const minDscr = validDscrs.length > 0 ? Math.min(...validDscrs) : 1.5;
    if (minDscr < 1) {
      warnings.push({
        level: "danger",
        title: "Critical Debt Service Risk (DSCR < 1.0x)",
        description: `Property NOI falls below annual mortgage payments (min DSCR is ${minDscr.toFixed(2)}x), causing negative leverage.`
      });
    } else if (minDscr < 1.25) {
      warnings.push({
        level: "warning",
        title: "Tight Lenders Coverage (DSCR < 1.25x)",
        description: `Minimum DSCR is ${minDscr.toFixed(2)}x, which may fail traditional commercial underwriting standards (1.25x minimum).`
      });
    }
    const negYears = results.projections.filter((p) => p.cashFlow < 0).map((p) => p.year);
    if (negYears.length > 0) {
      warnings.push({
        level: "warning",
        title: `Negative Net Cash Flow (Years: ${negYears.join(", ")})`,
        description: `Deal requires supplemental out-of-pocket capital injections during projected operational years.`
      });
    }
    if (results.ltv > 80) {
      warnings.push({
        level: "warning",
        title: "High Initial Leverage (LTV > 80%)",
        description: `Acquisition down payment is under 20%, increasing interest rate risk and default vulnerability.`
      });
    }
    if (results.breakEvenYear === "N/A" || results.breakEvenYear > 6) {
      warnings.push({
        level: "info",
        title: "Extended Payback Horizon",
        description: `Break-even year is ${results.breakEvenYear}, indicating longer equity payback duration.`
      });
    }
    const marketTier = inputs.marketTier || inputs.commTier || inputs.storageTier || "Tier2";
    const propClass = inputs.propertyClass || inputs.commClass || inputs.storageClass || "ClassB";
    const benchmarkRange = getBenchmarkCapRateRange(assetType, marketTier, propClass, inputs.facilityType || "");
    const exitCap = parseFloat(inputs.targetCapRate || inputs.targetExitCapRate || inputs.exitCapRate || 0);
    if (exitCap > 0 && benchmarkRange && exitCap < benchmarkRange.min - 0.5) {
      warnings.push({
        level: "warning",
        title: "Aggressive Exit Cap Rate Assumption",
        description: `Exit cap rate (${exitCap.toFixed(2)}%) is priced more aggressively than typical institutional ranges (${benchmarkRange.min.toFixed(2)}% - ${benchmarkRange.max.toFixed(2)}%) for ${marketTier} ${propClass} assets.`
      });
    }
    if (warnings.length === 0) {
      warnings.push({
        level: "success",
        title: "Robust Financial Profile",
        description: "Deal passes core DSCR, positive cash flow, and leverage health benchmarks."
      });
    }
    return warnings;
  }
  var PropertyMath = {
    calculateProjections,
    calculateMonthlyProjections,
    calculateMonthlyPayment,
    getAnnualAmortization,
    getMonthlyAmortization,
    calculateRemainingBalance,
    calculateSensitivityMatrix,
    runMonteCarloSimulation,
    buildAdaptiveHistogramBins,
    calculateTaxAndDepreciation,
    calculateTaxMetrics,
    calculateRefinanceEvent,
    solveTargetPurchasePrice,
    aggregatePortfolio,
    auditDealRisks,
    generateScenarioVariants,
    getBenchmarkCapRateRange,
    calculateHoldingPeriodWealth,
    calculateNPV,
    calculateIRR,
    normalizeAssetClass
  };
  if (typeof globalThis !== "undefined") {
    globalThis.PropertyMath = PropertyMath;
  }
  if (typeof window !== "undefined") {
    window.PropertyMath = PropertyMath;
  }
})();
