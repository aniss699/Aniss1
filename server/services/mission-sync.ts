import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { announcements } from '../../shared/schema.js';
import { Mission } from '../types/mission.js';

export class MissionSyncService {
  private db: ReturnType<typeof drizzle>;
  private pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool);
  }

  async syncMissionsToFeed(missions: Mission[]): Promise<void> {
    try {
      console.log('🔄 Synchronisation des missions vers le feed...');

      for (const mission of missions) {
        // Vérifier si la mission existe déjà dans announcements
        const existing = await this.db
          .select()
          .from(announcements)
          .where(sql`title = ${mission.title} AND description = ${mission.description}`)
          .limit(1);

        if (existing.length === 0) {
          const budgetValue = parseFloat(mission.budget.toString().replace(/[^0-9.-]/g, '')) || 0;
          await this.db.insert(announcements).values({
            title: mission.title,
            description: mission.description,
            category: mission.category.toLowerCase(),
            city: mission.location || null,
            budget_min: budgetValue.toString(),
            budget_max: budgetValue.toString(),
            user_id: parseInt(mission.clientId) || 1, // utiliser mission.clientId qui correspond à user.id
            status: mission.status === 'open' ? 'active' : 'inactive',
            quality_score: '0.8',
            created_at: new Date(mission.createdAt)
          });
          console.log(`✅ Mission "${mission.title}" ajoutée au feed`);
        }
      }

      console.log('✅ Synchronisation terminée');
    } catch (error) {
      console.error('❌ Erreur lors de la synchronisation:', error);
    }
  }

  async addMissionToFeed(mission: Mission): Promise<void> {
    try {
      const budgetValue = parseFloat(mission.budget.toString().replace(/[^0-9.-]/g, '')) || 0;
      await this.db.insert(announcements).values({
        title: mission.title,
        description: mission.description,
        category: mission.category.toLowerCase(),
        city: mission.location || null,
        budget_min: budgetValue.toString(),
        budget_max: budgetValue.toString(),
        user_id: parseInt(mission.clientId) || 1, // utiliser mission.clientId qui correspond à user.id
        status: 'active',
        quality_score: '0.8' // Score par défaut
      });
    } catch (error) {
      console.error('Erreur ajout mission au feed:', error);
      throw error;
    }
  }
}