package com.workapp.crew

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PriorityHigh
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.filled.ReportProblem
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Work
import androidx.compose.material.icons.filled.People
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.ui.screens.*
import com.workapp.crew.ui.theme.CrewHubTheme
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SessionViewModel @Inject constructor(private val authRepository: AuthRepository) : ViewModel() {
    val isLoggedIn = authRepository.isLoggedIn
    val currentRole: String? get() = authRepository.currentRole
    val currentFullName: String? get() = authRepository.currentFullName
    fun logout() = authRepository.logout()
}

private data class NavDestination(val route: String, val label: String, val icon: ImageVector)
private data class NavSection(val label: String, val destinations: List<NavDestination>)

// Mirrors web/src/components/AppShell.tsx's grouping (Operations / Materials / Resources / Admin)
// exactly, including which roles see the Admin section at all.
private val PAYROLL_CONFLICTS_ROLES = setOf("admin", "crew_lead")

private fun navSections(role: String?): List<NavSection> {
    val sections = mutableListOf(
        NavSection(
            "Operations",
            listOf(
                NavDestination("job_board", "Job Board", Icons.Filled.Work),
                NavDestination("clock_in", "Clock In", Icons.Filled.Schedule),
                NavDestination("chat", "Chat", Icons.Filled.Chat),
            ),
        ),
        NavSection(
            "Materials",
            listOf(
                NavDestination("inventory", "Inventory", Icons.Filled.Inventory),
                NavDestination("out_of_inventory", "Out Of Inventory", Icons.Filled.PriorityHigh),
                NavDestination("qr_share", "Share", Icons.Filled.QrCode),
            ),
        ),
        NavSection("Resources", listOf(NavDestination("documents", "Docs", Icons.Filled.Folder))),
    )

    val canViewPayroll = role in PAYROLL_CONFLICTS_ROLES
    val canReviewConflicts = role in PAYROLL_CONFLICTS_ROLES
    val isAdmin = role == "admin"
    if (canViewPayroll || canReviewConflicts || isAdmin) {
        sections.add(
            NavSection(
                "Admin",
                buildList {
                    if (canViewPayroll) add(NavDestination("payroll", "Payroll", Icons.Filled.Schedule))
                    if (canReviewConflicts) add(NavDestination("conflicts", "Conflicts", Icons.Filled.ReportProblem))
                    if (isAdmin) add(NavDestination("users", "Users", Icons.Filled.People))
                },
            ),
        )
    }
    return sections
}

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CrewHubTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    CrewOpsApp()
                }
            }
        }
    }
}

@Composable
private fun CrewOpsApp(sessionViewModel: SessionViewModel = hiltViewModel()) {
    val isLoggedIn by sessionViewModel.isLoggedIn.collectAsState()

    if (isLoggedIn) {
        AuthenticatedNavHost(sessionViewModel = sessionViewModel, onLogout = { sessionViewModel.logout() })
    } else {
        LoginScreen(onLoggedIn = { /* isLoggedIn flips reactively once tokens are saved */ })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AuthenticatedNavHost(sessionViewModel: SessionViewModel, onLogout: () -> Unit) {
    val navController = rememberNavController()
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    // Role only changes on a fresh login (the whole nav graph is torn down on logout), so a
    // synchronous read here — computed once per composition of this graph — is enough; it doesn't
    // need to react to role changes mid-session the way isLoggedIn does.
    val sections = remember(sessionViewModel.currentRole) { navSections(sessionViewModel.currentRole) }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet {
                Column(Modifier.padding(vertical = 8.dp)) {
                    Text(
                        "Crew Hub",
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp),
                    )
                    sections.forEach { section ->
                        Text(
                            section.label.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
                        )
                        section.destinations.forEach { destination ->
                            NavigationDrawerItem(
                                label = { Text(destination.label) },
                                icon = { Icon(destination.icon, contentDescription = null) },
                                selected = currentRoute == destination.route,
                                onClick = {
                                    scope.launch { drawerState.close() }
                                    navController.navigate(destination.route) {
                                        popUpTo(navController.graph.startDestinationId) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                            )
                        }
                    }
                    HorizontalDivider(Modifier.padding(vertical = 12.dp, horizontal = 24.dp))
                    Column(Modifier.padding(horizontal = 24.dp)) {
                        sessionViewModel.currentFullName?.let { Text(it, style = MaterialTheme.typography.titleSmall) }
                        sessionViewModel.currentRole?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    NavigationDrawerItem(
                        label = { Text("Sign out") },
                        icon = { Icon(Icons.Filled.Logout, contentDescription = null) },
                        selected = false,
                        onClick = { scope.launch { drawerState.close() }; onLogout() },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
                    )
                }
            }
        },
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Crew Hub") },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Filled.Menu, contentDescription = "Menu")
                        }
                    },
                )
            },
        ) { padding ->
            NavHost(
                navController = navController,
                startDestination = "job_board",
                modifier = Modifier.padding(padding),
            ) {
                composable("job_board") { JobBoardScreen() }
                composable("clock_in") { ClockInScreen() }
                composable("inventory") { InventoryScreen() }
                composable("out_of_inventory") { OutOfInventoryScreen() }
                composable("qr_share") { QrShareScreen() }
                composable("documents") {
                    DocumentLibraryScreen(onOpenMap = { documentId -> navController.navigate("map_editor/$documentId") })
                }
                composable("chat") { ChatScreen() }
                composable("payroll") { PayrollScreen() }
                composable("conflicts") { ConflictsScreen() }
                composable("users") { UsersScreen() }
                composable("map_editor/{documentId}") { backStackEntry ->
                    MapEditorScreen(documentId = backStackEntry.arguments?.getString("documentId").orEmpty())
                }
                composable("photo_proof/{jobId}") { backStackEntry ->
                    PhotoProofScreen(jobId = backStackEntry.arguments?.getString("jobId").orEmpty())
                }
            }
        }
    }
}
