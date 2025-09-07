import { UnifiedAIOutput, AIPhase } from '../types';
import { PredictionServiceClient } from '@google-cloud/aiplatform';
import { GoogleGenerativeAI } from '@google/generative-ai';
import policy from '../providers/policy.google.json' with { type: 'json' };
import { vertexAIConfig } from '../vertexAIConfig';

export async function geminiCall(phase: AIPhase, prompt:any) : Promise<UnifiedAIOutput> {
  const t0 = Date.now();
  
  // Configuration Vertex AI avec variables d'environnement
  const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID || 'secure-electron-471013-r0';
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  
  console.log('🎯 Initialisation Vertex AI (mode production)...');
  console.log('✅ Configuration Vertex AI:', {
    projectId,
    location,
    hasCredentials: !!credentialsJson,
    status: '🚀 PRODUCTION READY'
  });
  
  // VERTEX AI UNIQUEMENT - Plus de fallback
  console.log('🚀 Initialisation Vertex AI (mode priorité)...');
  
  let clientConfig: any = {
    projectId,
    location
  };
  
  // Parse et validation des credentials Vertex AI
  let credentials: any;
  if (credentialsJson) {
    try {
      credentials = JSON.parse(credentialsJson);
      clientConfig.credentials = credentials;
      console.log('✅ Credentials Vertex AI validés et chargés');
    } catch (credError) {
      console.error('❌ Erreur parsing credentials Vertex AI:', credError);
      throw new Error(`Format JSON des credentials Vertex AI invalide: ${credError.message}`);
    }
  } else {
    console.warn('⚠️ Pas de credentials JSON fournis, utilisation des credentials par défaut');
  }
  
  const client = new PredictionServiceClient(clientConfig);
  
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const endpoint = `projects/${projectId}/locations/${location}/publishers/google/models/${modelName}`;
  
  console.log(`🎯 Vertex AI Endpoint: ${endpoint}`);
  
  const instanceValue = {
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(prompt) }]}]
  };
  
  const parameter = {
    candidateCount: 1,
    maxOutputTokens: 8192,
    temperature: 0.1,
    responseMimeType: 'application/json',
    topP: 0.95,
    topK: 40
  };
  
  const request = {
    endpoint,
    instances: [instanceValue],
    parameters: parameter,
  };
  
  console.log('📡 Envoi requête Vertex AI (mode production)...');
  
  let text: string;
  try {
    const [response] = await client.predict(request);
    text = response.predictions?.[0]?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    if (!text) {
      throw new Error('Réponse vide de Vertex AI');
    }
    
    console.log('✅ Réponse Vertex AI reçue avec succès');
    
  } catch (vertexError) {
    console.error('🚨 ERREUR CRITIQUE VERTEX AI:', vertexError);
    throw new Error(`Vertex AI échoué: ${vertexError.message}. Vérifiez votre configuration Google Cloud.`);
  }

  let parsed:any;
  try { parsed = JSON.parse(text); } catch { parsed = { raw:text }; }

  const latency = Date.now() - t0;

  const out: UnifiedAIOutput = {
    phase,
    model_family: 'gemini',
    model_name: modelName,
    input_redacted: {}, // sera rempli par le logger après redaction
    output: parsed,
    quality: { latency_ms: latency },
    meta: {
      provider: 'vertex-ai',
      project_id: projectId,
      location: location,
      allow_training: !!policy.allow_training,
      provenance: 'vertex-ai-production',
      created_at: new Date().toISOString(),
      vertex_ai_priority: true
    }
  };
  return out;
}