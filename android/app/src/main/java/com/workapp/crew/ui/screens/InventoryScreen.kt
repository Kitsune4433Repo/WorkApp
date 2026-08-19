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
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.data.repository.InventoryRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

private val CATALOG_MANAGE_ROLES = setOf("admin", "crew_lead")

@HiltViewModel
class InventoryViewModel @Inject constructor(
    private val repository: InventoryRepository,
    authRepository: AuthRepository,
) : ViewModel() {
    val canManageCatalog = authRepository.currentRole in CATALOG_MANAGE_ROLES

    val haveLedger = repository.observeHaveLedger().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun adjust(materialId: String, delta: Double) = viewModelScope.launch { repository.adjust(materialId, delta, jobId = null) }

    fun refresh() = repository.refresh()

    fun addMaterial(name: String, category: String, unit: String) = viewModelScope.launch {
        repository.addMaterial(name, category, unit)
    }
}

/** Feature 1: work material ledger with instant plus/minus controls. Matches web's Material
 * Ledger: anyone can adjust quantities, but adding a brand-new material to the shared catalog is
 * admin/crew_lead only (enforced server-side; canManageCatalog just gates showing the form). */
@Composable
fun InventoryScreen(viewModel: InventoryViewModel = hiltViewModel()) {
    val items by viewModel.haveLedger.collectAsState()
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Truck Inventory", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))

        if (viewModel.canManageCatalog) {
            AddMaterialForm(onAdd = { name, category, unit -> viewModel.addMaterial(name, category, unit) })
            Spacer(Modifier.height(12.dp))
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(items, key = { it.materialId }) { row -> InventoryRowCard(row, onAdjust = { d -> viewModel.adjust(row.materialId, d) }) }
        }
    }
}

@Composable
private fun AddMaterialForm(onAdd: (name: String, category: String, unit: String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("unit") }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("Add material to catalog", style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Cancel" else "Add") }
            }
            if (expanded) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = category, onValueChange = { category = it }, label = { Text("Category") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = unit, onValueChange = { unit = it }, label = { Text("Unit (e.g. ea, spool, box)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        onAdd(name.trim(), category.trim(), unit.trim().ifBlank { "unit" })
                        name = ""; category = ""; unit = "unit"; expanded = false
                    },
                    enabled = name.isNotBlank() && category.isNotBlank(),
                    modifier = Modifier.align(androidx.compose.ui.Alignment.End),
                ) { Text("Save") }
            }
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
