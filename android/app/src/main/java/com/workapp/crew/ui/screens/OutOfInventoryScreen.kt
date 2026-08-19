package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.remote.RestockItemDto
import com.workapp.crew.data.repository.RestockRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OutOfInventoryViewModel @Inject constructor(private val repository: RestockRepository) : ViewModel() {
    private val _items = MutableStateFlow<List<RestockItemDto>>(emptyList())
    val items: StateFlow<List<RestockItemDto>> = _items.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch {
        _items.value = repository.list()
    }

    fun add(itemName: String, quantity: Double) = viewModelScope.launch {
        repository.create(itemName, "unit", quantity, note = null)
        refresh()
    }

    fun setQuantity(id: String, quantity: Double) = viewModelScope.launch {
        repository.setQuantity(id, quantity.coerceAtLeast(0.0))
        refresh()
    }

    fun remove(id: String) = viewModelScope.launch {
        repository.remove(id)
        refresh()
    }

    fun fulfill(id: String) = viewModelScope.launch {
        repository.fulfill(id)
        refresh()
    }
}

/** Out Of Inventory — mirrors web/src/pages/OutOfInventoryPage.tsx: a shared running list of
 * materials to buy or replace, open to anyone (no role gate on the backend either). */
@Composable
fun OutOfInventoryScreen(viewModel: OutOfInventoryViewModel = hiltViewModel()) {
    val items by viewModel.items.collectAsState()
    var newItemName by remember { mutableStateOf("") }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Out Of Inventory", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(
            "Materials to buy or replace. Clear an item once it's restocked.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = newItemName,
                onValueChange = { newItemName = it },
                placeholder = { Text("Item name") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = {
                    if (newItemName.isNotBlank()) {
                        viewModel.add(newItemName.trim(), 1.0)
                        newItemName = ""
                    }
                },
            ) { Text("Add") }
        }
        Spacer(Modifier.height(12.dp))

        if (items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Nothing flagged as out of stock.", style = MaterialTheme.typography.bodyMedium)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(items, key = { it.id }) { item ->
                    RestockCard(
                        item = item,
                        onAdjust = { delta ->
                            val current = item.quantity_needed.toDoubleOrNull() ?: 0.0
                            viewModel.setQuantity(item.id, current + delta)
                        },
                        onRestocked = { viewModel.fulfill(item.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun RestockCard(item: RestockItemDto, onAdjust: (Double) -> Unit, onRestocked: () -> Unit) {
    val quantity = item.quantity_needed.toDoubleOrNull() ?: 0.0
    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(item.item_name, style = MaterialTheme.typography.titleMedium)
                item.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            IconButton(onClick = { onAdjust(-1.0) }) { Icon(Icons.Filled.Remove, contentDescription = "Need one less") }
            Text("${quantity.toInt()} ${item.unit}", style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = { onAdjust(1.0) }) { Icon(Icons.Filled.Add, contentDescription = "Need one more") }
            TextButton(onClick = onRestocked) { Text("Restocked") }
        }
    }
}
