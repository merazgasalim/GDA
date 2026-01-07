/**
 * Electron Main Process Entry Point
 * ==================================
 * This is the main process - the authoritative source for:
 * - Database access
 * - License validation
 * - Encryption
 * - Export/Import permissions
 * 
 * SECURITY CONFIGURATION:
 * - contextIsolation: true
 * - nodeIntegration: false
 * - sandbox: true
 * - webSecurity: true
 * 
 * Reference: https://www.electronjs.org/docs/latest/tutorial/security
 */

import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { registerIpcHandlers, unregisterIpcHandlers } from './ipc-handlers';
import { initializeDatabase, closeDatabase } from './services/database-service';
import { validateLicense } from './services/license-service';

// ===========================================
// SINGLE INSTANCE LOCK (must be early!)
// ===========================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
}

// ===========================================
// SECURITY: Disable navigation to external URLs
// ===========================================
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Only allow navigation within the app
    if (parsedUrl.origin !== 'http://localhost:5173' && !navigationUrl.startsWith('file://')) {
      event.preventDefault();
      // Open external links in default browser
      shell.openExternal(navigationUrl);
    }
  });

  // Disable new window creation
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ===========================================
// WINDOW CREATION
// ===========================================

let mainWindow: BrowserWindow | null = null;

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
// Check if running in development mode - VITE_DEV_SERVER_URL is set by vite-plugin-electron
const isDev = !!process.env.VITE_DEV_SERVER_URL;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Gestion des Arrivages',
    icon: path.join(__dirname, '../build/icon.png'),
    frame: true, // Use native frame for now
    backgroundColor: '#f3f4f6',
    webPreferences: {
      // SECURITY: Preload script provides safe API
      preload: path.join(__dirname, 'preload.js'),
      // SECURITY: Isolate renderer context
      contextIsolation: true,
      // SECURITY: Disable Node.js in renderer
      nodeIntegration: false,
      // SECURITY: Enable sandbox
      sandbox: true,
      // SECURITY: Enable web security
      webSecurity: true,
      // SECURITY: Disable remote module
      // @ts-ignore - enableRemoteModule is deprecated but we explicitly disable it
      enableRemoteModule: false,
    },
  });

  // Register IPC handlers with window reference
  registerIpcHandlers(mainWindow);

  // Load the app
  if (isDev) {
    await mainWindow.loadURL(VITE_DEV_SERVER_URL);
    // Open DevTools in development
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===========================================
// APP LIFECYCLE
// ===========================================

// This method will be called when Electron has finished initialization
app.whenReady().then(async () => {
  // Validate license first
  const licenseStatus = await validateLicense();
  if (!licenseStatus?.isValid) {
    console.warn('License status invalid or missing:', licenseStatus);
  }

  // Initialize database
  const dbResult = await initializeDatabase();
  if (!dbResult.success) {
    console.warn('Database initialization warning:', dbResult.error);
    // Continue anyway - user might need to activate license first
  }

  // Create the main window
  await createWindow();

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup before quit
app.on('before-quit', async () => {
  unregisterIpcHandlers();
  await closeDatabase();
});

// ===========================================
// SECURITY: Handle certificate errors
// ===========================================
app.on('certificate-error', (event, _webContents, _url, _error, _certificate, callback) => {
  // In development, you might want to allow self-signed certs
  if (process.env.NODE_ENV === 'development') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Handle second instance - focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

// Export for testing
export { mainWindow };
