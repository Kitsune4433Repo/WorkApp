package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.remote.PayrollPeriodDetailDto
import com.workapp.crew.data.remote.PayrollPeriodDto
import com.workapp.crew.data.remote.PersonPeriodTotalsDto
import com.workapp.crew.data.remote.WeeklySummaryDto
import com.workapp.crew.data.repository.PayrollRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PayrollViewModel @Inject constructor(private val repository: PayrollRepository) : ViewModel() {
    private val _current = MutableStateFlow<WeeklySummaryDto?>(null)
    val current: StateFlow<WeeklySummaryDto?> = _current.asStateFlow()

    private val _periods = MutableStateFlow<List<PayrollPeriodDto>>(emptyList())
    val periods: StateFlow<List<PayrollPeriodDto>> = _periods.asStateFlow()

    private val _selected = MutableStateFlow<PayrollPeriodDetailDto?>(null)
    val selected: StateFlow<PayrollPeriodDetailDto?> = _selected.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch { _current.value = repository.weeklySummary() }
        viewModelScope.launch { _periods.value = repository.periods() }
        _selected.value?.let { selectPeriod(it.id) }
    }

    fun selectPeriod(id: String?) = viewModelScope.launch {
        _selected.value = id?.let { repository.periodDetail(it) }
    }
}

private fun centsToMoney(cents: String?): String {
    val value = cents?.toLongOrNull() ?: 0L
    return "$${"%.2f".format(value / 100.0)}"
}

/** Payroll (admin/crew_lead) — mirrors web/src/pages/PayrollSummaryPage.tsx: the in-progress week's
 * totals per person, and a browsable archive of prior closed-out weeks. */
@Composable
fun PayrollScreen(viewModel: PayrollViewModel = hiltViewModel()) {
    val current by viewModel.current.collectAsState()
    val periods by viewModel.periods.collectAsState()
    val selected by viewModel.selected.collectAsState()
    var selectedId by remember { mutableStateOf<String?>(null) }
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Payroll", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(
            "Pay weeks run Thursday through Wednesday and close out automatically Wednesday night.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))

        Text("This week${current?.label?.let { " — $it" } ?: ""}", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        current?.let { PeopleTable(it.people, it.totalWageCents.toString()) } ?: Text("Loading…", style = MaterialTheme.typography.bodySmall)

        Spacer(Modifier.height(20.dp))
        Text("Past weeks", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        if (periods.isEmpty()) {
            Text("No weeks have closed out yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(periods, key = { it.id }) { period ->
                    FilterChip(
                        selected = selectedId == period.id,
                        onClick = {
                            selectedId = if (selectedId == period.id) null else period.id
                            viewModel.selectPeriod(selectedId)
                        },
                        label = { Text(period.label) },
                    )
                }
            }
            selected?.let { detail ->
                Spacer(Modifier.height(12.dp))
                PeopleTable(detail.people, detail.total_wage_cents)
            }
        }
    }
}

@Composable
private fun PeopleTable(people: List<PersonPeriodTotalsDto>, totalWageCents: String) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            if (people.isEmpty()) {
                Text("No completed shifts yet this period.", style = MaterialTheme.typography.bodySmall)
            } else {
                LazyColumn(Modifier.heightIn(max = 260.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(people, key = { it.user_id ?: it.user_full_name_snapshot ?: it.hashCode().toString() }) { person ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(person.full_name ?: person.user_full_name_snapshot ?: "—", style = MaterialTheme.typography.bodyMedium)
                            Text("${"%.2f".format(person.total_minutes / 60.0)}h · ${centsToMoney(person.earnings_cents)}", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            HorizontalDivider()
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Total wage cost", style = MaterialTheme.typography.titleSmall)
                Text(centsToMoney(totalWageCents), style = MaterialTheme.typography.titleSmall)
            }
        }
    }
}
