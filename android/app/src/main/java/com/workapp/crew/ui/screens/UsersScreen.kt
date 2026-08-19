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
import com.workapp.crew.data.remote.UserListItemDto
import com.workapp.crew.data.repository.UsersRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

private val ROLES = listOf("admin", "crew_lead", "crew")
private val ROLE_LABELS = mapOf("admin" to "Admin", "crew_lead" to "Crew Lead", "crew" to "Crew")

@HiltViewModel
class UsersViewModel @Inject constructor(private val repository: UsersRepository) : ViewModel() {
    private val _users = MutableStateFlow<List<UserListItemDto>>(emptyList())
    val users: StateFlow<List<UserListItemDto>> = _users.asStateFlow()

    init { refresh() }

    fun refresh() = viewModelScope.launch { _users.value = repository.list() }

    fun create(email: String, password: String, fullName: String, role: String) = viewModelScope.launch {
        repository.create(email, password, fullName, role, hourlyRateCents = 0)
        refresh()
    }

    fun setActive(id: String, isActive: Boolean) = viewModelScope.launch {
        repository.setActive(id, isActive)
        refresh()
    }

    fun delete(id: String) = viewModelScope.launch {
        repository.delete(id)
        refresh()
    }
}

/** Users (admin only) — mirrors web/src/pages/UserManagementPage.tsx: this app has no public
 * sign-up, so an admin creates every account here. */
@Composable
fun UsersScreen(viewModel: UsersViewModel = hiltViewModel()) {
    val users by viewModel.users.collectAsState()
    var showCreate by remember { mutableStateOf(false) }
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Users", style = MaterialTheme.typography.headlineSmall)
            TextButton(onClick = { showCreate = !showCreate }) { Text(if (showCreate) "Cancel" else "Add") }
        }
        Spacer(Modifier.height(8.dp))

        if (showCreate) {
            CreateUserForm(
                onCreate = { email, password, fullName, role ->
                    viewModel.create(email, password, fullName, role)
                    showCreate = false
                },
            )
            Spacer(Modifier.height(12.dp))
        }

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(users, key = { it.id }) { user ->
                UserCard(
                    user = user,
                    onToggleActive = { viewModel.setActive(user.id, !user.is_active) },
                    onDelete = { viewModel.delete(user.id) },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateUserForm(onCreate: (email: String, password: String, fullName: String, role: String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var fullName by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("crew") }
    var roleMenuExpanded by remember { mutableStateOf(false) }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = fullName, onValueChange = { fullName = it }, label = { Text("Full name") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Password (min 8 chars)") }, modifier = Modifier.fillMaxWidth())

            ExposedDropdownMenuBox(expanded = roleMenuExpanded, onExpandedChange = { roleMenuExpanded = it }) {
                OutlinedTextField(
                    value = ROLE_LABELS[role].orEmpty(),
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Role") },
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                )
                ExposedDropdownMenu(expanded = roleMenuExpanded, onDismissRequest = { roleMenuExpanded = false }) {
                    ROLES.forEach { r ->
                        DropdownMenuItem(text = { Text(ROLE_LABELS[r].orEmpty()) }, onClick = { role = r; roleMenuExpanded = false })
                    }
                }
            }

            Button(
                onClick = { onCreate(email.trim(), password, fullName.trim(), role) },
                enabled = email.isNotBlank() && password.length >= 8 && fullName.isNotBlank(),
                modifier = Modifier.align(Alignment.End),
            ) { Text("Create account") }
        }
    }
}

@Composable
private fun UserCard(user: UserListItemDto, onToggleActive: () -> Unit, onDelete: () -> Unit) {
    var confirmingDelete by remember { mutableStateOf(false) }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(user.full_name, style = MaterialTheme.typography.titleMedium)
                Text("${user.email} · ${ROLE_LABELS[user.role] ?: user.role}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = onToggleActive) { Text(if (user.is_active) "Deactivate" else "Reactivate") }
            TextButton(onClick = { confirmingDelete = true }) { Text("Delete") }
        }
    }

    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text("Delete ${user.full_name}?") },
            text = { Text("This permanently removes their account and login. This cannot be undone.") },
            confirmButton = { TextButton(onClick = { confirmingDelete = false; onDelete() }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text("Cancel") } },
        )
    }
}
