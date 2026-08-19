package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.local.dao.HaveLedgerRow
import com.workapp.crew.data.repository.InventoryRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class InventoryViewModel @Inject constructor(private val repository: InventoryRepository) : ViewModel() {
    val haveLedger = repository.observeHaveLedger().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun adjust(materialId: String, delta: Double) = viewModelScope.launch { repository.adjust(materialId, delta, jobId = null) }

    fun refresh() = repository.refresh()
}

/** Feature 1: work material ledger with instant plus/minus controls. */
@Composable
fun InventoryScreen(viewModel: InventoryViewModel = hiltViewModel()) {
    val items by viewModel.haveLedger.collectAsState()
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Truck Inventory", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.materialId }) { row -> InventoryRowCard(row, onAdjust = { d -> viewModel.adjust(row.materialId, d) }) }
        }
    }
}

@Composable
private fun InventoryRowCard(row: HaveLedgerRow, onAdjust: (Double) -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(row.name, style = MaterialTheme.typography.titleMedium)
                Text(row.sku, style = MaterialTheme.typography.bodySmall)
            }
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                IconButton(onClick = { onAdjust(-1.0) }) { Icon(Icons.Filled.Remove, contentDescription = "Subtract") }
                Text("${row.quantityHave.toInt()} ${row.unit}", style = MaterialTheme.typography.titleLarge)
                IconButton(onClick = { onAdjust(1.0) }) { Icon(Icons.Filled.Add, contentDescription = "Add") }
            }
        }
    }
}
