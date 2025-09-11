import { Router } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../database.js';
import { missions, bids as bidTable, users } from '../../shared/schema.js';
import { MissionSyncService } from '../services/mission-sync.js';
import { DataConsistencyValidator } from '../services/data-consistency-validator.js';
import { randomUUID } from 'crypto';

// Error wrapper for async routes
const asyncHandler = (fn: Function) => (req: any, res: any, next: any) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Utilitaire pour générer un excerpt à partir de la description
function generateExcerpt(description: string, maxLength: number = 200): string {
  if (!description || description.length <= maxLength) {
    return description || '';
  }

  // Chercher la fin de phrase la plus proche avant maxLength
  const truncated = description.substring(0, maxLength);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf('!'),
    truncated.lastIndexOf('?')
  );

  if (lastSentenceEnd > maxLength * 0.6) {
    return truncated.substring(0, lastSentenceEnd + 1).trim();
  }

  // Sinon, couper au dernier espace pour éviter de couper un mot
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.6) {
    return truncated.substring(0, lastSpace).trim() + '...';
  }

  return truncated.trim() + '...';
}

const router = Router();

// POST /api/missions - Create new mission (optimized)
router.post('/', asyncHandler(async (req, res) => {
  const requestId = randomUUID();
  const startTime = Date.now();

  // console.log(`🚀 Creating mission - Request ID: ${requestId}`); // Reduced logging

  // 1. Validation et extraction des données
  const { title, description, category, budget, location, userId, postal_code } = req.body;

  // Validation rapide
  if (!title || typeof title !== 'string' || title.trim().length < 3) {
    console.log(`❌ Validation failed - title: ${title}`);
    return res.status(400).json({
      ok: false,
      error: 'Le titre doit contenir au moins 3 caractères',
      field: 'title',
      request_id: requestId
    });
  }

  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    console.log(`❌ Validation failed - description length: ${description?.length || 0}`);
    return res.status(400).json({
      ok: false,
      error: 'La description doit contenir au moins 10 caractères',
      field: 'description',
      request_id: requestId
    });
  }

  const userIdInt = userId ? parseInt(userId.toString()) : 1;
  if (isNaN(userIdInt) || userIdInt <= 0) {
    console.log(`❌ Validation failed - userId: ${userId}`);
    return res.status(400).json({
      ok: false,
      error: 'User ID invalide',
      field: 'userId',
      request_id: requestId
    });
  }

  // 2. Préparer les données avec valeurs par défaut
  const now = new Date();
  const budgetCents = budget ? parseInt(budget.toString()) * 100 : 100000;

  // Helper function to extract city from a location string
  const extractCity = (locationString: string | null | undefined): string | null => {
    if (!locationString) return null;
    // Basic extraction: assume city is the last part before a comma or the whole string
    const parts = locationString.split(',');
    return parts.length > 1 ? parts[parts.length - 1].trim() : locationString.trim();
  };

  const newMission = {
    title: title.trim(),
    description: description.trim() +
      (req.body.requirements ? `\n\nExigences spécifiques: ${req.body.requirements}` : ''),
    category: category || 'developpement',
    budget_value_cents: budgetCents,
    currency: 'EUR',
    location_raw: location || null,
    postal_code: req.body.postal_code || null, // Added postal_code field
    city: extractCity(location),
    country: 'France',
    remote_allowed: req.body.remote_allowed !== false,
    user_id: userIdInt,
    client_id: userIdInt,
    status: 'published' as const,
    urgency: 'medium' as const,
    is_team_mission: false,
    team_size: 1,
    created_at: now,
    updated_at: now
  };

  // Simplified logging for performance
  console.log(`📝 Mission prepared: ${newMission.title.substring(0, 30)}...`);

  // 3. Transaction robuste avec INSERT RETURNING
  console.log(JSON.stringify({
    level: 'info',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    action: 'db_transaction_start'
  }));

  const insertResult = await db.insert(missions).values(newMission).returning({
    id: missions.id,
    title: missions.title,
    status: missions.status,
    user_id: missions.user_id,
    created_at: missions.created_at
  });

  if (!insertResult || insertResult.length === 0) {
    throw new Error('Insert failed - no result returned');
  }

  const insertedMission = insertResult[0];

  console.log(JSON.stringify({
    level: 'info',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    action: 'db_insert_success',
    mission_id: insertedMission.id,
    execution_time_ms: Date.now() - startTime
  }));

  // 4. Récupérer la mission complète pour la réponse
  const fullMission = await db
    .select()
    .from(missions)
    .where(eq(missions.id, insertedMission.id))
    .limit(1);

  if (fullMission.length === 0) {
    throw new Error('Mission not found after insert');
  }

  const mission = fullMission[0];

  // 5. Préparer la réponse complète
  const responsePayload = {
    ok: true,
    id: mission.id,
    title: mission.title,
    description: mission.description,
    excerpt: generateExcerpt(mission.description || '', 200),
    category: mission.category,
    budget: mission.budget_value_cents?.toString() || '0',
    budget_value_cents: mission.budget_value_cents,
    currency: mission.currency,
    location: mission.location_raw || mission.postal_code || 'Remote', // Use postal_code if location_raw is empty
    user_id: mission.user_id,
    client_id: mission.client_id,
    status: mission.status,
    urgency: mission.urgency,
    remote_allowed: mission.remote_allowed,
    is_team_mission: mission.is_team_mission,
    team_size: mission.team_size,
    created_at: mission.created_at,
    updated_at: mission.updated_at,
    createdAt: mission.created_at?.toISOString() || now.toISOString(),
    updatedAt: mission.updated_at?.toISOString(),
    clientName: 'Client',
    bids: [],
    request_id: requestId
  };

  console.log(JSON.stringify({
    level: 'info',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    action: 'mission_create_success',
    mission_id: mission.id,
    total_time_ms: Date.now() - startTime
  }));

  // 6. Réponse 201 avec ID garanti
  res.status(201).json(responsePayload);

  // 7. Synchronisation en arrière-plan (non-bloquant)
  setImmediate(async () => {
    try {
      const missionSync = new MissionSyncService(process.env.DATABASE_URL || 'postgresql://localhost:5432/swideal');
      const missionForFeed = {
        id: mission.id.toString(),
        title: mission.title,
        description: mission.description,
        category: mission.category || 'developpement',
        budget: mission.budget_value_cents?.toString() || '0',
        location: mission.location_raw || mission.postal_code || 'Remote', // Use postal_code for feed
        status: (mission.status as 'open' | 'in_progress' | 'completed' | 'closed') || 'open',
        clientId: mission.user_id?.toString() || '1',
        clientName: 'Client',
        createdAt: mission.created_at?.toISOString() || now.toISOString(),
        bids: []
      };
      await missionSync.addMissionToFeed(missionForFeed);

      console.log(JSON.stringify({
        level: 'info',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        action: 'feed_sync_success',
        mission_id: mission.id
      }));
    } catch (syncError) {
      console.log(JSON.stringify({
        level: 'warn',
        timestamp: new Date().toISOString(),
        request_id: requestId,
        action: 'feed_sync_failed',
        mission_id: mission.id,
        error: syncError instanceof Error ? syncError.message : 'Unknown sync error'
      }));
    }
  });
}));

// GET /api/missions - Get all missions with bids (simplified)
router.get('/', asyncHandler(async (req, res) => {
  const requestId = randomUUID();
  const startTime = Date.now();
  
  console.log(JSON.stringify({
    level: 'info',
    timestamp: new Date().toISOString(),
    request_id: requestId,
    action: 'missions_list_start'
  }));

  try {
    // Simplified query with error handling
    const allMissions = await db
      .select()
      .from(missions)
      .where(eq(missions.status, 'published'))
      .orderBy(desc(missions.created_at))
      .limit(50); // Limite pour éviter surcharge

    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      action: 'missions_query_success',
      count: allMissions.length,
      execution_time_ms: Date.now() - startTime
    }));

    // Transform missions safely
    const missionsWithBids = allMissions.map(mission => {
      try {
        return {
          id: mission.id,
          title: mission.title || 'Mission sans titre',
          description: mission.description || '',
          excerpt: generateExcerpt(mission.description || '', 200),
          category: mission.category || 'general',
          
          // Budget handling
          budget_value_cents: mission.budget_value_cents || 0,
          budget: mission.budget_value_cents?.toString() || '0',
          currency: mission.currency || 'EUR',
          
          // Location handling 
          location_raw: mission.location_raw,
          postal_code: mission.postal_code,
          city: mission.city,
          country: mission.country || 'France',
          location: mission.location_raw || mission.postal_code || mission.city || 'Remote',
          remote_allowed: mission.remote_allowed !== false,
          
          // User and status
          user_id: mission.user_id,
          client_id: mission.client_id || mission.user_id,
          clientName: 'Client anonyme',
          status: mission.status || 'published',
          urgency: mission.urgency || 'medium',
          
          // Timestamps
          created_at: mission.created_at,
          updated_at: mission.updated_at,
          createdAt: mission.created_at?.toISOString() || new Date().toISOString(),
          updatedAt: mission.updated_at?.toISOString(),
          
          // Team info
          is_team_mission: mission.is_team_mission || false,
          team_size: mission.team_size || 1,
          
          // Additional fields
          deadline: mission.deadline?.toISOString(),
          tags: mission.tags || [],
          skills_required: mission.skills_required || [],
          requirements: mission.requirements,
          
          // Bids (empty for list view)
          bids: []
        };
      } catch (transformError) {
        console.error('❌ Error transforming mission:', mission.id, transformError);
        return null;
      }
    }).filter(Boolean); // Remove null entries

    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      action: 'missions_list_success',
      returned_count: missionsWithBids.length,
      total_time_ms: Date.now() - startTime
    }));

    res.json(missionsWithBids);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      action: 'missions_list_error',
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      execution_time_ms: Date.now() - startTime
    }));

    res.status(500).json({
      ok: false,
      error: 'Internal server error',
      details: 'An error occurred',
      error_type: 'server_error',
      timestamp: new Date().toISOString(),
      request_id: requestId,
      debug_mode: process.env.NODE_ENV === 'development'
    });
  }
}));

// GET /api/missions/health - Health check endpoint (must be before /:id route)
router.get('/health', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  console.log('🏥 Mission health check endpoint called');

  try {
    // Test database connectivity
    const dbTest = await db.select({ count: sql`COUNT(*)` }).from(missions).limit(1);
    const dbConnected = dbTest.length > 0;

    // Calculate response time
    const responseTime = Date.now() - startTime;

    const healthInfo = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'missions-api',
      environment: process.env.NODE_ENV || 'development',
      database: dbConnected ? 'connected' : 'disconnected',
      response_time_ms: responseTime,
      uptime_seconds: Math.floor(process.uptime()),
      memory_usage: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    };

    console.log('🏥 Health check passed:', healthInfo);
    res.status(200).json(healthInfo);
  } catch (error) {
    console.error('🏥 Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'missions-api',
      environment: process.env.NODE_ENV || 'development',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
      response_time_ms: Date.now() - startTime
    });
  }
}));

// GET /api/missions/debug - Diagnostic endpoint (must be before /:id route)
router.get('/debug', asyncHandler(async (req, res) => {
  console.log('🔍 Mission debug endpoint called');

  // Test database connection
  const testQuery = await db.select({ id: missions.id }).from(missions).limit(1);

  // Check database structure
  const dbInfo = {
    status: 'connected',
    sampleMissions: testQuery.length,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL ? 'configured' : 'missing'
  };

  console.log('🔍 Database info:', dbInfo);
  res.json(dbInfo);
}));

// GET /api/missions/verify-sync - Vérifier la synchronisation missions/feed
router.get('/verify-sync', asyncHandler(async (req, res) => {
  console.log('🔍 Vérification de la synchronisation missions/feed');

  try {
    // Récupérer les dernières missions
    const recentMissions = await db.select({
      id: missions.id,
      title: missions.title,
      description: missions.description,
      category: missions.category,
      budget_value_cents: missions.budget_value_cents,
      currency: missions.currency,
      location_raw: missions.location_raw,
      postal_code: missions.postal_code, // Include postal_code
      city: missions.city,
      country: missions.country,
      remote_allowed: missions.remote_allowed,
      user_id: missions.user_id,
      client_id: missions.client_id,
      status: missions.status,
      urgency: missions.urgency,
      deadline: missions.deadline,
      tags: missions.tags,
      skills_required: missions.skills_required,
      requirements: missions.requirements,
      is_team_mission: missions.is_team_mission,
      team_size: missions.team_size,
      created_at: missions.created_at,
      updated_at: missions.updated_at
    })
      .from(missions)
      .orderBy(desc(missions.created_at))
      .limit(5);

    // Vérifier la présence dans le feed (table announcements)
    const { announcements } = await import('../../shared/schema.js');

    const feedItems = await db.select({
      id: announcements.id,
      title: announcements.title,
      description: announcements.description,
      category: announcements.category,
      budget_value_cents: announcements.budget_value_cents,
      currency: announcements.currency,
      location_raw: announcements.location_raw,
      postal_code: announcements.postal_code, // Assuming announcements table also has postal_code
      city: announcements.city,
      country: announcements.country,
      remote_allowed: announcements.remote_allowed,
      user_id: announcements.user_id,
      client_id: announcements.client_id,
      status: announcements.status,
      urgency: announcements.urgency,
      deadline: announcements.deadline,
      tags: announcements.tags,
      skills_required: announcements.skills_required,
      requirements: announcements.requirements,
      is_team_mission: announcements.is_team_mission,
      team_size: announcements.team_size,
      created_at: announcements.created_at,
      updated_at: announcements.updated_at
    })
      .from(announcements)
      .orderBy(desc(announcements.created_at))
      .limit(10);

    const syncStatus = {
      totalMissions: recentMissions.length,
      totalFeedItems: feedItems.length,
      recentMissions: recentMissions.map(m => ({
        id: m.id,
        title: m.title,
        status: m.status,
        created_at: m.created_at
      })),
      feedItems: feedItems.map(f => ({
        id: f.id,
        title: f.title,
        status: f.status,
        created_at: f.created_at
      })),
      syncHealth: feedItems.length > 0 ? 'OK' : 'WARNING'
    };

    console.log('🔍 Sync status:', syncStatus);
    res.json(syncStatus);
  } catch (error) {
    console.error('🔍 Verify sync error:', error);
    res.status(500).json({
      error: 'Erreur lors de la vérification de synchronisation',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}));

// GET /api/missions/:id - Get a specific mission with bids
router.get('/:id', asyncHandler(async (req, res) => {
  let missionId: string | null = null;

  missionId = req.params.id;
  console.log('🔍 API: Récupération mission ID:', missionId);

  // Skip validation for special endpoints that should be handled elsewhere
  if (missionId === 'debug' || missionId === 'verify-sync' || missionId === 'health') {
    console.log('⚠️ API: Endpoint spécial détecté, ignoré dans cette route:', missionId);
    return res.status(404).json({ error: 'Endpoint non trouvé' });
  }

  if (!missionId || missionId === 'undefined' || missionId === 'null') {
    console.error('❌ API: Mission ID invalide:', missionId);
    return res.status(400).json({
      error: 'Mission ID invalide',
      details: 'L\'ID de mission est requis et ne peut pas être vide'
    });
  }

  // Convert missionId to integer for database query with better validation
  const missionIdInt = parseInt(missionId, 10);
  if (isNaN(missionIdInt) || missionIdInt <= 0 || !Number.isInteger(missionIdInt)) {
    console.error('❌ API: Mission ID n\'est pas un nombre valide:', missionId);
    return res.status(400).json({
      error: 'Mission ID doit être un nombre entier valide',
      received: missionId,
      details: 'L\'ID doit être un nombre entier positif'
    });
  }

  // Use simple select() to avoid Drizzle column mapping issues
  const mission = await db
    .select({
      id: missions.id,
      title: missions.title,
      description: missions.description,
      category: missions.category,
      budget_value_cents: missions.budget_value_cents,
      currency: missions.currency,
      location_raw: missions.location_raw,
      postal_code: missions.postal_code, // Include postal_code
      city: missions.city,
      country: missions.country,
      remote_allowed: missions.remote_allowed,
      user_id: missions.user_id,
      client_id: missions.client_id,
      status: missions.status,
      urgency: missions.urgency,
      deadline: missions.deadline,
      tags: missions.tags,
      skills_required: missions.skills_required,
      requirements: missions.requirements,
      is_team_mission: missions.is_team_mission,
      team_size: missions.team_size,
      created_at: missions.created_at,
      updated_at: missions.updated_at
    })
    .from(missions)
    .where(eq(missions.id, missionIdInt))
    .limit(1);

  if (mission.length === 0) {
    console.error('❌ API: Mission non trouvée:', missionId);
    return res.status(404).json({
      error: 'Mission non trouvée',
      missionId: missionIdInt,
      details: 'Aucune mission trouvée avec cet ID'
    });
  }

  // Get bids for this mission with error handling
  let missionBids = [];
  try {
    missionBids = await db
      .select({
        id: bidTable.id,
        amount: bidTable.amount,
        timeline_days: bidTable.timeline_days,
        message: bidTable.message,
        score_breakdown: bidTable.score_breakdown,
        is_leading: bidTable.is_leading,
        status: bidTable.status,
        created_at: bidTable.created_at,
        provider_name: users.name,
        provider_email: users.email,
        provider_profile: users.profile_data
      })
      .from(bidTable)
      .leftJoin(users, eq(bidTable.provider_id, users.id))
      .where(eq(bidTable.mission_id, missionIdInt));
  } catch (error) {
    console.warn('⚠️ Could not fetch bids (table may not exist):', error);
    missionBids = [];
  }


  const result = {
    ...mission[0],
    excerpt: generateExcerpt(mission[0].description || '', 200),
    bids: missionBids || [],
    // Ensure consistent budget format for frontend
    budget: mission[0].budget_value_cents?.toString() || '0',
    // Ensure consistent location format, prioritize postal_code
    location: mission[0].location_raw || mission[0].postal_code || mission[0].city || 'Remote',
    // Ensure consistent timestamps
    createdAt: mission[0].created_at?.toISOString() || new Date().toISOString(),
    updatedAt: mission[0].updated_at?.toISOString()
  };

  console.log('✅ API: Mission trouvée:', result.title, 'avec', result.bids.length, 'offres');
  res.json(result);
}));

// GET /api/users/:userId/missions - Get missions for a specific user
router.get('/users/:userId/missions', asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  console.log('👤 Fetching missions for user:', userId);
  console.log('🔗 Mapping: userId =', userId, '-> user_id filter:', userId);

  if (!userId || userId === 'undefined' || userId === 'null') {
    console.error('❌ Invalid user ID:', userId);
    return res.status(400).json({
      error: 'User ID invalide',
      details: 'L\'ID utilisateur est requis'
    });
  }

  const userIdInt = parseInt(userId, 10);
  if (isNaN(userIdInt) || userIdInt <= 0 || !Number.isInteger(userIdInt)) {
    console.error('❌ User ID is not a valid number:', userId);
    return res.status(400).json({
      error: 'User ID doit être un nombre entier valide',
      received: userId,
      details: 'L\'ID utilisateur doit être un nombre entier positif'
    });
  }

  console.log('🔍 Querying database: SELECT * FROM missions WHERE user_id =', userIdInt);

  // Use simple select() without explicit column mapping to avoid Drizzle errors
  const userMissions = await db
    .select({
      id: missions.id,
      title: missions.title,
      description: missions.description,
      category: missions.category,
      budget_value_cents: missions.budget_value_cents,
      currency: missions.currency,
      location_raw: missions.location_raw,
      postal_code: missions.postal_code, // Include postal_code
      city: missions.city,
      country: missions.country,
      remote_allowed: missions.remote_allowed,
      user_id: missions.user_id,
      client_id: missions.client_id,
      status: missions.status,
      urgency: missions.urgency,
      deadline: missions.deadline,
      tags: missions.tags,
      skills_required: missions.skills_required,
      requirements: missions.requirements,
      is_team_mission: missions.is_team_mission,
      team_size: missions.team_size,
      created_at: missions.created_at,
      updated_at: missions.updated_at
    })
    .from(missions)
    .where(eq(missions.user_id, userIdInt))
    .orderBy(desc(missions.created_at));

  console.log('📊 Query result: Found', userMissions.length, 'missions with user_id =', userIdInt);
  userMissions.forEach(mission => {
    console.log('   📋 Mission:', mission.id, '| user_id:', mission.user_id, '| title:', mission.title);
  });

  // Transform missions to match frontend interface with full consistency
  const missionsWithBids = userMissions.map(mission => ({
    // Core fields - ensure exact mapping
    id: mission.id,
    title: mission.title,
    description: mission.description,
    excerpt: generateExcerpt(mission.description || '', 200),
    category: mission.category,
    // Budget - maintain consistency with database values
    budget_value_cents: mission.budget_value_cents,
    budget: mission.budget_value_cents?.toString() || '0',
    currency: mission.currency,
    // Location - full structure, prioritize postal_code
    location_raw: mission.location_raw,
    location: mission.location_raw || mission.postal_code || mission.city || 'Remote',
    postal_code: mission.postal_code,
    city: mission.city,
    country: mission.country,
    remote_allowed: mission.remote_allowed,
    // Status and metadata
    status: mission.status,
    urgency: mission.urgency,
    // User relationships - preserve exact values
    user_id: mission.user_id,
    client_id: mission.client_id,
    userId: mission.user_id?.toString(),
    clientName: 'Moi', // Consistent with API format
    // Team configuration
    is_team_mission: mission.is_team_mission,
    team_size: mission.team_size,
    // Timestamps - consistent formatting
    created_at: mission.created_at,
    updated_at: mission.updated_at,
    createdAt: mission.created_at?.toISOString() || new Date().toISOString(),
    updatedAt: mission.updated_at?.toISOString(),
    deadline: mission.deadline?.toISOString(),
    // Arrays and metadata
    tags: mission.tags || [],
    skills_required: mission.skills_required || [],
    requirements: mission.requirements,
    bids: [] // We'll populate this separately if needed
  }));

  console.log(`👤 Found ${missionsWithBids.length} missions for user ${userId}`);
  res.json(missionsWithBids);
}));

// GET /api/users/:userId/bids - Get bids for a specific user
router.get('/users/:userId/bids', asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  console.log('👤 Fetching bids for user:', userId);

  if (!userId || userId === 'undefined' || userId === 'null') {
    console.error('❌ Invalid user ID:', userId);
    return res.status(400).json({ error: 'User ID invalide' });
  }

  // Convert userId to integer for database query
  const userIdInt = parseInt(userId, 10);
  if (isNaN(userIdInt)) {
    console.error('❌ User ID is not a valid number:', userId);
    return res.status(400).json({ error: 'User ID doit être un nombre' });
  }

  // TODO: Query user bids when bids table exists
  // const userBids = await db
  //   .select()
  //   .from(bidTable)
  //   .where(eq(bidTable.provider_id, userIdInt))
  //   .orderBy(desc(bidTable.created_at));
  const userBids = []; // Placeholder until bids table is created

  console.log('🔗 Mapping: userId =', userId, '-> provider_id filter:', userIdInt);

  console.log(`👤 Found ${userBids.length} bids for user ${userId}`);
  res.json(userBids);
}));

// PUT /api/missions/:id - Update a specific mission
router.put('/:id', asyncHandler(async (req, res) => {
  const missionId = req.params.id;
  const updateData = req.body;
  console.log('✏️ API: Modification mission ID:', missionId);
  console.log('✏️ API: Données reçues:', JSON.stringify(updateData, null, 2));

  // Skip special endpoints
  if (missionId === 'debug' || missionId === 'verify-sync') {
    return res.status(404).json({ error: 'Endpoint non trouvé' });
  }

  if (!missionId || missionId === 'undefined' || missionId === 'null') {
    console.error('❌ API: Mission ID invalide:', missionId);
    return res.status(400).json({ error: 'Mission ID invalide' });
  }

  const missionIdInt = parseInt(missionId, 10);
  if (isNaN(missionIdInt) || missionIdInt <= 0) {
    console.error('❌ API: Mission ID n\'est pas un nombre valide:', missionId);
    return res.status(400).json({ error: 'Mission ID doit être un nombre valide' });
  }

  // Validate required fields
  if (!updateData.title || updateData.title.trim() === '') {
    return res.status(400).json({
      error: 'Le titre est requis',
      field: 'title'
    });
  }

  if (!updateData.description || updateData.description.trim() === '') {
    return res.status(400).json({
      error: 'La description est requise',
      field: 'description'
    });
  }

  // Check if mission exists - select only id for existence check
  const existingMission = await db
    .select({ id: missions.id, category: missions.category, deadline: missions.deadline, tags: missions.tags, requirements: missions.requirements, currency: missions.currency, city: missions.city, country: missions.country, postal_code: missions.postal_code }) // Include postal_code
    .from(missions)
    .where(eq(missions.id, missionIdInt))
    .limit(1);

  if (existingMission.length === 0) {
    console.error('❌ API: Mission non trouvée pour modification:', missionId);
    return res.status(404).json({ error: 'Mission non trouvée' });
  }

  // Helper function to extract city from a location string
  const extractCity = (locationString: string | null | undefined): string | null => {
    if (!locationString) return null;
    const parts = locationString.split(',');
    return parts.length > 1 ? parts[parts.length - 1].trim() : locationString.trim();
  };

  // Prepare update data
  const missionToUpdate = {
    title: updateData.title,
    description: updateData.description,
    category: updateData.category || existingMission[0].category,
    budget_value_cents: updateData.budget ? parseInt(updateData.budget) : null,
    location_raw: updateData.location || null,
    postal_code: updateData.postal_code || existingMission[0].postal_code, // Update postal_code
    city: updateData.city || existingMission[0].city, // Assuming city might be provided separately or extracted
    country: updateData.country || existingMission[0].country,
    urgency: updateData.urgency || 'medium',
    status: updateData.status || 'published',
    updated_at: new Date(),
    deadline: updateData.deadline ? new Date(updateData.deadline) : existingMission[0].deadline,
    tags: updateData.tags || existingMission[0].tags,
    requirements: updateData.requirements || existingMission[0].requirements,
    currency: updateData.currency || existingMission[0].currency,
    remote_allowed: updateData.remote_allowed !== undefined ? updateData.remote_allowed : true,
  };

  console.log('✏️ API: Données de mise à jour:', JSON.stringify(missionToUpdate, null, 2));

  // Update the mission
  const updatedMission = await db
    .update(missions)
    .set(missionToUpdate)
    .where(eq(missions.id, missionIdInt))
    .returning();

  if (updatedMission.length === 0) {
    throw new Error('Échec de la mise à jour de la mission');
  }

  console.log('✅ API: Mission modifiée avec succès:', missionId);
  res.json(updatedMission[0]);
}));

// DELETE /api/missions/:id - Delete a specific mission
router.delete('/:id', asyncHandler(async (req, res) => {
  const missionId = req.params.id;
  console.log('🗑️ API: Suppression mission ID:', missionId);

  // Skip special endpoints
  if (missionId === 'debug' || missionId === 'verify-sync') {
    return res.status(404).json({ error: 'Endpoint non trouvé' });
  }

  if (!missionId || missionId === 'undefined' || missionId === 'null') {
    console.error('❌ API: Mission ID invalide:', missionId);
    return res.status(400).json({ error: 'Mission ID invalide' });
  }

  // Convert missionId to integer for database query
  const missionIdInt = parseInt(missionId, 10);
  if (isNaN(missionIdInt) || missionIdInt <= 0) {
    console.error('❌ API: Mission ID n\'est pas un nombre valide:', missionId);
    return res.status(400).json({ error: 'Mission ID doit être un nombre valide' });
  }

  // Check if mission exists - select only id for existence check
  const existingMission = await db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.id, missionIdInt))
    .limit(1);

  if (existingMission.length === 0) {
    console.error('❌ API: Mission non trouvée pour suppression:', missionId);
    return res.status(404).json({ error: 'Mission non trouvée' });
  }

  // TODO: Delete associated bids first when bids table exists
  // await db.delete(bidTable).where(eq(bidTable.mission_id, missionIdInt));
  // console.log('✅ API: Offres supprimées pour mission:', missionId);

  // Delete the mission
  const deletedMission = await db
    .delete(missions)
    .where(eq(missions.id, missionIdInt))
    .returning();

  if (deletedMission.length === 0) {
    throw new Error('Échec de la suppression de la mission');
  }

  console.log('✅ API: Mission supprimée avec succès:', missionId);
  res.json({ message: 'Mission supprimée avec succès', mission: deletedMission[0] });
}));

export default router;