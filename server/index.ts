import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { setupVite, serveStatic, log } from './vite.js';
import { Mission } from './types/mission.js';
import { MissionSyncService } from './services/mission-sync.js';
import { validateEnvironment } from './environment-check.js';
import { Pool } from 'pg';
import cors from 'cors'; // Import cors

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validation des variables d'environnement au démarrage
validateEnvironment();

const app = express();
const port = parseInt(process.env.PORT || '5000', 10);

// Initialize services with Replit PostgreSQL
const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/swideal';

console.log('🔗 Using Replit PostgreSQL connection');

const missionSyncService = new MissionSyncService(databaseUrl);

// Create a pool instance for health checks with timeout
const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,  // 5 second timeout
  idleTimeoutMillis: 10000,       // 10 second idle timeout
  max: 20                         // maximum number of connections
});

// Log database configuration for debugging
console.log('🔗 Database configuration:', {
  DATABASE_URL: !!process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  PLATFORM: 'Replit'
});

// Validate database connection with timeout
async function validateDatabaseConnection() {
  const timeout = 8000; // 8 second timeout
  try {
    console.log('🔍 Validating database connection...');

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database connection timeout')), timeout);
    });

    const connectionPromise = pool.query('SELECT 1 as test');

    await Promise.race([connectionPromise, timeoutPromise]);
    console.log('✅ Database connection validated successfully');
    return true;
  } catch (error) {
    console.warn('⚠️ Database connection validation failed (non-blocking):', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

// Validate database connection on startup (non-blocking)
setImmediate(async () => {
  await validateDatabaseConnection();
});

// Création des comptes démo simplifiée (non bloquant) - moved to after server start
setImmediate(async () => {
  try {
    console.log('✅ Comptes démo - vérification différée');
  } catch (error) {
    console.warn('⚠️ Comptes démo - vérification échouée');
  }
});

// Remove in-memory missions storage - using database only

// Initialize global variables safely
if (!global.projectStandardizations) {
  global.projectStandardizations = new Map();
}
if (!global.aiEnhancementCache) {
  global.aiEnhancementCache = new Map();
}
if (!global.performanceMetrics) {
  global.performanceMetrics = new Map();
}

// Log Gemini AI configuration for debugging
console.log('🔍 Gemini AI Environment Variables:', {
  GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
  PROVIDER: 'gemini-api-only'
});

// Middleware anti-cache pour développement
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  next();
});

// Trust proxy for Replit environment
app.set('trust proxy', true);

// CORS configuration - optimized for Replit
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://swideal.com', 'https://www.swideal.com', /\.replit\.app$/]
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());

// Import auth routes
import authRoutes from './auth-routes.js';
// Import missions routes here
import missionsRoutes from './routes/missions.js';
// Import projects supprimé - remplacé par missions
import apiRoutes from './api-routes.js';
import aiMonitoringRoutes from './routes/ai-monitoring-routes.js';
import aiRoutes from './routes/ai-routes.js';
import aiSuggestionsRoutes from './routes/ai-suggestions-routes.js';
import aiMissionsRoutes from './routes/ai-missions-routes.js';
import aiOrchestratorRoutes from '../apps/api/src/routes/ai.js';
import feedRoutes from './routes/feed-routes.js';
import favoritesRoutes from './routes/favorites-routes.js';
import missionDemoRoutes from './routes/mission-demo.js';
import aiQuickAnalysisRoutes from './routes/ai-quick-analysis.js';
import aiDiagnosticRoutes from './routes/ai-diagnostic-routes.js';
import aiLearningRoutes from './routes/ai-learning-routes.js';
import teamRoutes from './routes/team-routes.js';

// Import rate limiting middleware
import { aiRateLimit, strictAiRateLimit, monitoringRateLimit } from './middleware/ai-rate-limit.js';

// Mount routes
// Register missions routes first
console.log('📋 Registering missions routes...');
app.use('/api/missions', missionsRoutes);

console.log('📋 Registering other API routes...');
app.use('/api', apiRoutes);
app.use('/api', missionsRoutes); // Pour les routes /api/users/:userId/missions
// Route projects supprimée - remplacée par missions
app.use('/api/projects', () => { throw new Error('Projects API is deprecated and has been replaced by Missions API'); });

// Apply rate limiting to AI routes
app.use('/api/ai/monitoring', monitoringRateLimit, aiMonitoringRoutes);
app.use('/api/ai/suggest-pricing', strictAiRateLimit);  // Endpoint coûteux
app.use('/api/ai/enhance-description', strictAiRateLimit);  // Endpoint coûteux
app.use('/api/ai/analyze-quality', strictAiRateLimit);  // Endpoint coûteux
app.use('/api/ai/enhance-text', strictAiRateLimit);  // Endpoint coûteux
app.use('/api/ai', aiRateLimit, aiRoutes);  // Rate limiting général pour les autres routes IA
app.use('/api/ai', aiRateLimit, aiSuggestionsRoutes);
app.use('/api/ai/missions', aiRateLimit, aiMissionsRoutes);
app.use('/api-ai-orchestrator', strictAiRateLimit, aiOrchestratorRoutes);  // Orchestrateur IA complexe
app.use('/api', aiRateLimit, aiQuickAnalysisRoutes);  // Analyses IA rapides

// Register AI diagnostic and learning routes
app.use('/api/ai/diagnostic', aiDiagnosticRoutes);
app.use('/api/ai/suggestions', aiSuggestionsRoutes);
app.use('/api/ai/learning', aiLearningRoutes);

app.use('/api', feedRoutes);
app.use('/api', favoritesRoutes);
app.use('/api', missionDemoRoutes);
app.use('/api/team', teamRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT 1');

    res.status(200).json({
      status: 'ok',
      message: 'SwipDEAL API is running',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: process.env.NODE_ENV || 'development',
      database: 'connected'
    });
  } catch (error) {
    console.error('Health check database error:', error);
    res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      env: process.env.NODE_ENV || 'development',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Debug endpoint pour diagnostique - simplified
app.get('/api/debug/missions', (req, res) => {
  res.json({
    debug_info: {
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
      status: 'database_unified',
      memory_usage: process.memoryUsage(),
    },
    message: 'Check /api/missions for actual missions data'
  });
});

app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'swideal-api',
    version: '1.0.0',
    node_env: process.env.NODE_ENV
  });
});

// Gemini AI diagnostic endpoint
app.get('/api/ai/gemini-diagnostic', (req, res) => {
  const hasApiKey = !!process.env.GEMINI_API_KEY;

  res.json({
    gemini_ai_configured: hasApiKey,
    api_key: hasApiKey ? 'CONFIGURED' : 'MISSING',
    status: hasApiKey ? 'ready' : 'incomplete',
    provider: 'gemini-api-only'
  });
});

// Missions endpoints now handled by server/routes/missions.ts (database-only)

// Mission POST endpoint now handled by server/routes/missions.ts (database-only)

// Mission GET by ID endpoint now handled by server/routes/missions.ts (database-only)

// Start server
const server = createServer(app);

// Start listening immediately for faster deployment
server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 SwipDEAL server running on http://0.0.0.0:${port}`);
  console.log(`📱 Frontend: http://0.0.0.0:${port}`);
  console.log(`🔧 API Health: http://0.0.0.0:${port}/api/health`);
  console.log(`🎯 AI Provider: Gemini API Only`);
  console.log(`🔍 Process ID: ${process.pid}`);
  console.log(`🔍 Node Environment: ${process.env.NODE_ENV || 'development'}`);

  // Setup environment based on NODE_ENV only
  if (process.env.NODE_ENV === 'production') {
    console.log('🏭 Production mode: serving static files');
    serveStatic(app);
  } else {
    console.log('🛠️ Development mode: setting up Vite dev server...');
    setupVite(app, server).catch(error => {
      console.error('⚠️ Vite setup failed (non-critical):', error);
    });
  }
});

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${port} is already in use. Server will exit and let Replit handle restart.`);
    console.error(`💡 The deployment compilation issues have been fixed. This is just a port conflict that should resolve on restart.`);
    process.exit(1);
  } else {
    console.error('❌ Server error:', err);
    process.exit(1);
  }
});


// Mission sync now handled by database routes

console.log('✅ Advanced AI routes registered - Gemini API Only');

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Global error handler
app.use((error: any, req: any, res: any, next: any) => {
  console.error('🚨 Global error handler:', error);
  console.error('🚨 Request URL:', req.url);
  console.error('🚨 Request method:', req.method);
  console.error('🚨 Request body:', req.body);

  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

export default app;