export interface ExerciseTemplate {
  name: string;
  muscleGroup: string;
  defaultRestSec: number;
}

export const EXERCISE_LIBRARY: ExerciseTemplate[] = [
  // Pecs
  { name: 'Développé couché barre', muscleGroup: 'Pectoraux', defaultRestSec: 120 },
  { name: 'Développé incliné haltères', muscleGroup: 'Pectoraux', defaultRestSec: 90 },
  { name: 'Développé couché haltères', muscleGroup: 'Pectoraux', defaultRestSec: 90 },
  { name: 'Écartés poulie vis-à-vis', muscleGroup: 'Pectoraux', defaultRestSec: 60 },
  { name: 'Dips lestés', muscleGroup: 'Pectoraux', defaultRestSec: 90 },
  { name: 'Chest press machine', muscleGroup: 'Pectoraux', defaultRestSec: 90 },
  // Dos
  { name: 'Tractions lestées', muscleGroup: 'Dos', defaultRestSec: 120 },
  { name: 'Tirage vertical prise large', muscleGroup: 'Dos', defaultRestSec: 90 },
  { name: 'Rowing barre', muscleGroup: 'Dos', defaultRestSec: 120 },
  { name: 'Rowing haltère unilatéral', muscleGroup: 'Dos', defaultRestSec: 75 },
  { name: 'Tirage horizontal poulie basse', muscleGroup: 'Dos', defaultRestSec: 90 },
  { name: 'Face pull poulie', muscleGroup: 'Dos', defaultRestSec: 60 },
  // Épaules
  { name: 'Développé militaire barre', muscleGroup: 'Épaules', defaultRestSec: 120 },
  { name: 'Développé épaules haltères', muscleGroup: 'Épaules', defaultRestSec: 90 },
  { name: 'Élévations latérales haltères', muscleGroup: 'Épaules', defaultRestSec: 60 },
  { name: 'Élévations latérales poulie', muscleGroup: 'Épaules', defaultRestSec: 60 },
  { name: 'Oiseau banc incliné', muscleGroup: 'Épaules', defaultRestSec: 60 },
  // Jambes
  { name: 'Squat barre', muscleGroup: 'Jambes', defaultRestSec: 150 },
  { name: 'Presse à cuisses', muscleGroup: 'Jambes', defaultRestSec: 120 },
  { name: 'Soulevé de terre roumain', muscleGroup: 'Jambes', defaultRestSec: 120 },
  { name: 'Fentes bulgares', muscleGroup: 'Jambes', defaultRestSec: 90 },
  { name: 'Leg extension', muscleGroup: 'Jambes', defaultRestSec: 60 },
  { name: 'Leg curl assis', muscleGroup: 'Jambes', defaultRestSec: 60 },
  { name: 'Mollets debout machine', muscleGroup: 'Jambes', defaultRestSec: 60 },
  // Bras
  { name: 'Curl barre EZ', muscleGroup: 'Biceps', defaultRestSec: 75 },
  { name: 'Curl haltères incliné', muscleGroup: 'Biceps', defaultRestSec: 60 },
  { name: 'Curl marteau', muscleGroup: 'Biceps', defaultRestSec: 60 },
  { name: 'Extensions triceps poulie corde', muscleGroup: 'Triceps', defaultRestSec: 60 },
  { name: 'Barre au front', muscleGroup: 'Triceps', defaultRestSec: 75 },
  { name: 'Extension triceps au-dessus tête', muscleGroup: 'Triceps', defaultRestSec: 60 },
  // Abdos & Cardio
  { name: 'Crunch poulie haute', muscleGroup: 'Abdos', defaultRestSec: 60 },
  { name: 'Relevés de jambes suspendu', muscleGroup: 'Abdos', defaultRestSec: 60 },
  { name: 'Gainage planche', muscleGroup: 'Abdos', defaultRestSec: 45 },
  { name: 'Tapis incliné (marche rapide)', muscleGroup: 'Cardio', defaultRestSec: 30 },
];
