

import { ServiceModeCard } from '@/components/ServiceModeCard';
import type { ServiceMode } from '@/lib/types/services';

const serviceModes: ServiceMode[] = [
  {
    id: 'flash',
    title: 'Flash Deals Services',
    description: 'Besoin urgent ? Obtenez des devis en temps record avec nos prestataires disponibles immédiatement.',
    emoji: '⚡',
    href: '/services/flash',
    color: 'text-orange-600'
  },
  {
    id: 'abonnement',
    title: 'Abonnement Inversé',
    description: 'Définissez votre besoin récurrent et laissez les experts se positionner sur votre planning.',
    emoji: '📅',
    href: '/services/abonnement',
    color: 'text-green-600'
  },
  {
    id: 'groupe',
    title: 'Demandes Groupées',
    description: 'Mutualisez vos besoins avec d\'autres clients pour obtenir des tarifs préférentiels.',
    emoji: '🤝',
    href: '/services/groupe',
    color: 'text-blue-600'
  },
  {
    id: 'ia',
    title: 'IA + Humain',
    description: 'Notre IA analyse votre besoin et le transforme en brief expert pour les meilleurs prestataires.',
    emoji: '🤖',
    href: '/services/ia',
    color: 'text-purple-600'
  },
  {
    id: 'opportunites',
    title: 'Opportunités Locales',
    description: 'Découvrez les créneaux libres près de chez vous et réservez instantanément.',
    emoji: '⏳',
    href: '/services/opportunites',
    color: 'text-indigo-600'
  }
];

export default function ServicesPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-block p-3 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-4">
            <span className="text-white text-2xl">🚀</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Choisissez votre mode de service
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            5 façons révolutionnaires de trouver et collaborer avec les meilleurs prestataires
          </p>
        </div>

        {/* Service modes grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {serviceModes.map((mode) => (
            <ServiceModeCard 
              key={mode.id} 
              mode={mode}
              className="w-full"
            />
          ))}
        </div>

        {/* CTA Section */}
        <div className="text-center mt-16 p-8 bg-white rounded-2xl shadow-lg">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">
            Pas sûr de votre choix ?
          </h3>
          <p className="text-gray-600 mb-6">
            Notre équipe peut vous conseiller le mode le plus adapté à votre projet
          </p>
          <button className="bg-gradient-to-r from-emerald-500 to-blue-600 hover:from-emerald-600 hover:to-blue-700 text-white font-bold px-8 py-3 rounded-full transition-all duration-300 hover:scale-105 shadow-lg">
            💬 Discuter avec un expert
          </button>
        </div>
      </div>
    </div>
  );
}
