package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.remote.SyncConflictDto
import com.workapp.crew.data.repository.ConflictsRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ConflictsViewModel @Inject constructor(private val repository: ConflictsRepository) : ViewModel() {
    private val _conflicts = MutableStateFlow<List<SyncConflictDto>>(emptyList())
    val conflicts: StateFlow<List<SyncConflictDto>> = _conflicts.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch { _conflicts.value = repository.list() }

    fun resolve(id: String, resolution: String) = viewModelScope.launch {
        repository.resolve(id, resolution)
        refresh()
    }
}

/** Conflicts (admin/crew_lead) — mirrors web/src/pages/ConflictReviewPage.tsx: offline edits from
 * two devices that couldn't merge automatically, held here until a human picks a winner. */
@Composable
fun ConflictsScreen(viewModel: ConflictsViewModel = hiltViewModel()) {
    val conflicts by viewModel.conflicts.collectAsState()
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Conflicts", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(4.dp))
        Text(
            "Offline edits that couldn't merge automatically.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        if (conflicts.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Nothing pending review.", style = MaterialTheme.typography.bodyMedium)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(conflicts, key = { it.id }) { conflict ->
                    ConflictCard(conflict, onResolve = { resolution -> viewModel.resolve(conflict.id, resolution) })
                }
            }
        }
    }
}

@Composable
private fun ConflictCard(conflict: SyncConflictDto, onResolve: (String) -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(conflict.entity_type.replace('_', ' ').replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium)
            Text("Device ${conflict.device_id}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { onResolve("server_wins") }) { Text("Keep server") }
                OutlinedButton(onClick = { onResolve("client_wins") }) { Text("Keep device") }
            }
        }
    }
}
