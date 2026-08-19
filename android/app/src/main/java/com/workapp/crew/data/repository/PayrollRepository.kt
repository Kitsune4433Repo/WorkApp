package com.workapp.crew.data.repository

import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.PayrollPeriodDetailDto
import com.workapp.crew.data.remote.PayrollPeriodDto
import com.workapp.crew.data.remote.WeeklySummaryDto
import javax.inject.Inject
import javax.inject.Singleton

/** Payroll (admin/crew_lead only): the current in-progress Thu-Wed week's totals, plus a browsable
 * archive of prior weeks — matches web/src/pages/PayrollSummaryPage.tsx. */
@Singleton
class PayrollRepository @Inject constructor(private val api: ApiService) {
    suspend fun weeklySummary(): WeeklySummaryDto = api.getWeeklySummary()
    suspend fun periods(): List<PayrollPeriodDto> = api.getPayrollPeriods()
    suspend fun periodDetail(id: String): PayrollPeriodDetailDto = api.getPayrollPeriodDetail(id)
}
