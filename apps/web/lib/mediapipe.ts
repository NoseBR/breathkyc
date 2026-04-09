import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

let faceLandmarker: FaceLandmarker | null = null;
let isInitializing = false;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (faceLandmarker) return faceLandmarker;

  // Wait if initialization is already in progress
  if (isInitializing) {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (faceLandmarker) {
          clearInterval(checkInterval);
          resolve(faceLandmarker);
        }
      }, 100);
    });
  }

  isInitializing = true;
  
  try {
    const vision = await FilesetResolver.forVisionTasks("/models");
    
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "/models/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
      runningMode: "VIDEO"
    });

    isInitializing = false;
    return faceLandmarker;
  } catch (error) {
    isInitializing = false;
    console.error("Failed to load FaceLandmarker", error);
    throw error;
  }
}
