package com.workapp.crew

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.QrCode
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.ui.screens.*
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class SessionViewModel @Inject constructor(private val authRepository: AuthRepository) : ViewModel() {
    val isLoggedIn = authRepository.isLoggedIn
    fun logout() = authRepository.logout()
}

private data class BottomDestination(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val BOTTOM_DESTINATIONS = listOf(
    BottomDestination("clock_in", "Clock In", Icons.Filled.Schedule),
    BottomDestination("inventory", "Inventory", Icons.Filled.Inventory),
    BottomDestination("qr_share", "Share", Icons.Filled.QrCode),
    BottomDestination("documents", "Docs", Icons.Filled.Folder),
    BottomDestination("chat", "Chat", Icons.Filled.Chat),
)

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
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
        AuthenticatedNavHost(onLogout = { sessionViewModel.logout() })
    } else {
        LoginScreen(onLoggedIn = { /* isLoggedIn flips reactively once tokens are saved */ })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AuthenticatedNavHost(onLogout: () -> Unit) {
    val navController = rememberNavController()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Crew Hub") },
                actions = {
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Filled.Logout, contentDescription = "Sign out")
                    }
                },
            )
        },
        bottomBar = { CrewBottomBar(navController) },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = "clock_in",
            modifier = Modifier.padding(padding),
        ) {
            composable("clock_in") { ClockInScreen() }
            composable("inventory") { InventoryScreen() }
            composable("qr_share") { QrShareScreen() }
            composable("documents") {
                DocumentLibraryScreen(onOpenMap = { documentId -> navController.navigate("map_editor/$documentId") })
            }
            composable("chat") { ChatScreen() }
            composable("map_editor/{documentId}") { backStackEntry ->
                MapEditorScreen(documentId = backStackEntry.arguments?.getString("documentId").orEmpty())
            }
            composable("photo_proof/{jobId}") { backStackEntry ->
                PhotoProofScreen(jobId = backStackEntry.arguments?.getString("jobId").orEmpty())
            }
        }
    }
}

@Composable
private fun CrewBottomBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route

    NavigationBar {
        BOTTOM_DESTINATIONS.forEach { destination ->
            NavigationBarItem(
                selected = currentRoute == destination.route,
                onClick = {
                    navController.navigate(destination.route) {
                        popUpTo(navController.graph.startDestinationId) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { Icon(destination.icon, contentDescription = destination.label) },
                label = { Text(destination.label) },
            )
        }
    }
}
