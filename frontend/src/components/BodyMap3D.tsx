import {
  Billboard,
  ContactShadows,
  Html,
  OrbitControls,
  useGLTF,
} from "@react-three/drei";
import {
  Canvas,
  ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  forwardRef,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ElementRef,
} from "react";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
} from "three";
import {
  anatomicalRegion,
  HUMAN_MODEL_CENTER_Z,
  type BodyPoint,
} from "../bodyRegions";
import { createBodySurfaceProjector } from "../bodyMapSurface";
import {
  bodyMapFocusPose,
  type BodyMapFocusPose,
} from "../bodyMapCamera";
import {
  hasBodyMapCameraMoved,
  isIntentionalBodyMapClick,
} from "../bodyMapInteraction";
import { bodyMapMarkerScale } from "../bodyMapMarkers";
import { attentionLabels } from "../risk";
import type { Lesion } from "../types";
import {
  BodyViewControls,
  type BodyView,
} from "./BodyViewControls";
import { BodyMapFrame } from "./BodyMapFrame";
import { BodyMapMarkerReadout } from "./BodyMapMarkerReadout";
import {
  BodyMapModelError,
  BodyMapModelErrorBoundary,
  BodyMapModelLoading,
} from "./BodyMapModelState";
import { BodyMapRegionReadout } from "./BodyMapRegionReadout";
import { BodyMapZoomControls } from "./BodyMapZoomControls";

interface Props {
  lesions: Lesion[];
  selectedLesionId: number | null;
  disabled: boolean;
  busy: boolean;
  repositioningLesion: Lesion | null;
  onCreatePoint: (
    bodyPart: string,
    point: { x: number; y: number; z: number },
  ) => void;
  onSelectLesion: (lesion: Lesion) => void;
  onCancelReposition: () => void;
}

const HUMAN_MODEL_URL = "/models/neutral-human-body.glb";
const HUMAN_SCALE = 0.32;
const HUMAN_POSITION: [number, number, number] = [
  0,
  -0.04,
  HUMAN_MODEL_CENTER_Z,
];
const MARKER_COLORS = {
  not_assessed: { color: "#657772", emissive: "#16201e" },
  low: { color: "#2f9d66", emissive: "#0b301d" },
  intermediate: { color: "#7355a6", emissive: "#211236" },
  high: { color: "#c8424b", emissive: "#3f090d" },
  uncertain: { color: "#7355a6", emissive: "#211236" },
} as const;
const LEGEND_ITEMS = [
  { key: "not_assessed", label: "Not assessed" },
  { key: "low", label: attentionLabels.low },
  { key: "high", label: attentionLabels.high },
  { key: "uncertain", label: attentionLabels.uncertain },
] as const;

function HumanModel({
  disabled,
  onCreatePoint,
  onHoverRegion,
}: Pick<Props, "disabled" | "onCreatePoint"> & {
  onHoverRegion: (region: string | null) => void;
}) {
  const { scene } = useGLTF(HUMAN_MODEL_URL);
  const material = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: "#bcaea5",
        metalness: 0,
        roughness: 0.58,
        clearcoat: 0.12,
        clearcoatRoughness: 0.72,
      }),
    [],
  );
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.material = material;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    return clone;
  }, [material, scene]);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      material.dispose();
    },
    [material],
  );

  function createPoint(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    if (disabled || !isIntentionalBodyMapClick(event.delta)) return;
    onCreatePoint(anatomicalRegion(event.point), {
      x: event.point.x,
      y: event.point.y,
      z: event.point.z,
    });
  }

  return (
    <primitive
      object={model}
      name="neutral-human-body"
      position={HUMAN_POSITION}
      scale={HUMAN_SCALE}
      onClick={createPoint}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (!disabled) document.body.style.cursor = "crosshair";
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (disabled) {
          onHoverRegion(null);
          return;
        }
        onHoverRegion(anatomicalRegion(event.point));
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
        onHoverRegion(null);
      }}
    />
  );
}

function LesionMarker({
  lesion,
  markerPoint,
  selected,
  onSelect,
  onHover,
}: {
  lesion: Lesion;
  markerPoint: BodyPoint;
  selected: boolean;
  onSelect: (lesion: Lesion) => void;
  onHover: (lesion: Lesion | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const markerRef = useRef<Group>(null);
  const classification = lesion.attention_level ?? "not_assessed";
  const marker = MARKER_COLORS[classification];

  useFrame(({ camera }) => {
    if (!markerRef.current) return;
    const distance = camera.position.distanceTo(markerRef.current.position);
    markerRef.current.scale.setScalar(
      bodyMapMarkerScale(distance, hovered),
    );
  });

  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );

  return (
    <group
      ref={markerRef}
      position={[markerPoint.x, markerPoint.y, markerPoint.z]}
      onClick={(event) => {
        event.stopPropagation();
        if (!isIntentionalBodyMapClick(event.delta)) return;
        onSelect(lesion);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered(true);
        onHover(lesion);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        onHover(null);
        document.body.style.cursor = "";
      }}
    >
      <mesh>
        <sphereGeometry args={[0.032, 18, 18]} />
        <meshStandardMaterial
          color={marker.color}
          emissive={marker.emissive}
          roughness={0.38}
        />
      </mesh>
      {lesion.risk_status === "experimental" && (
        <mesh>
          <sphereGeometry args={[0.043, 12, 12]} />
          <meshBasicMaterial
            color="#29433e"
            wireframe
            transparent
            opacity={0.85}
          />
        </mesh>
      )}
      {selected && (
        <Billboard>
          <mesh>
            <ringGeometry args={[0.048, 0.059, 32]} />
            <meshBasicMaterial
              color="#f7c948"
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
        </Billboard>
      )}
    </group>
  );
}

interface BodyViewRequest {
  view: BodyView | "free";
  revision: number;
  focus?: BodyMapFocusPose;
}

interface BodyCameraHandle {
  zoomIn: () => void;
  zoomOut: () => void;
}

interface BodyCameraProps {
  request: BodyViewRequest;
  onOrbitStart: () => void;
  onOrbitEnd: () => void;
}

const BodyCamera = forwardRef<BodyCameraHandle, BodyCameraProps>(function BodyCamera(
  { request, onOrbitStart, onOrbitEnd },
  ref,
) {
  const { camera, size } = useThree();
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const orbitStart = useRef<{
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  } | null>(null);
  const minDistance = request.focus ? 0.7 : 1.45;
  const maxDistance = 13;

  function zoomBy(factor: number) {
    const orbitControls = controls.current;
    if (!orbitControls) return;

    const offset = camera.position.clone().sub(orbitControls.target);
    const currentDistance = offset.length();
    if (currentDistance === 0) return;

    const nextDistance = Math.min(
      maxDistance,
      Math.max(minDistance, currentDistance * factor),
    );
    camera.position.copy(
      orbitControls.target.clone().add(offset.setLength(nextDistance)),
    );
    camera.updateProjectionMatrix();
    orbitControls.update();
  }

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(0.78),
    zoomOut: () => zoomBy(1.28),
  }));

  useEffect(() => {
    if (request.focus) {
      const perspective = camera as PerspectiveCamera;
      perspective.position.set(...request.focus.position);
      perspective.up.set(0, 1, 0);
      perspective.lookAt(...request.focus.target);
      perspective.updateProjectionMatrix();
      controls.current?.target.set(...request.focus.target);
      controls.current?.update();
      return;
    }

    if (request.view === "free") return;

    const perspective = camera as PerspectiveCamera;
    const halfVerticalFov = (perspective.fov * Math.PI) / 360;
    const aspect = size.width / Math.max(size.height, 1);
    const verticalDistance = 2.95 / Math.tan(halfVerticalFov);
    const halfHorizontalSpan =
      request.view === "front" || request.view === "back" ? 2.78 : 0.7;
    const horizontalDistance =
      halfHorizontalSpan / (Math.tan(halfVerticalFov) * aspect);
    const distance = Math.max(verticalDistance, horizontalDistance);
    const lateralViewX = distance * 0.86;
    const lateralViewZ = distance * 0.52;
    const position: Record<BodyView, [number, number, number]> = {
      front: [0, 0, distance],
      back: [0, 0, -distance],
      left: [-lateralViewX, 0, lateralViewZ],
      right: [lateralViewX, 0, lateralViewZ],
    };

    perspective.position.set(...position[request.view]);
    perspective.up.set(0, 1, 0);
    perspective.lookAt(0, 0, 0);
    perspective.updateProjectionMatrix();
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [
    camera,
    request.revision,
    request.view,
    request.focus,
    size.height,
    size.width,
  ]);

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={minDistance}
      maxDistance={maxDistance}
      zoomSpeed={1.28}
      zoomToCursor
      target={[0, 0, 0]}
      onStart={() => {
        orbitStart.current = {
          position: camera.position.clone(),
          target: controls.current?.target.clone() ?? { x: 0, y: 0, z: 0 },
        };
        onOrbitStart();
      }}
      onEnd={() => {
        const start = orbitStart.current;
        orbitStart.current = null;
        const endTarget = controls.current?.target;
        if (
          start &&
          endTarget &&
          hasBodyMapCameraMoved(
            start.position,
            camera.position,
            start.target,
            endTarget,
          )
        ) {
          onOrbitEnd();
        }
      }}
    />
  );
});

function BodyScene({
  onHoverRegion,
  onHoverLesion,
  ...props
}: Props & {
  onHoverRegion: (region: string | null) => void;
  onHoverLesion: (lesion: Lesion | null) => void;
}) {
  const { scene } = useGLTF(HUMAN_MODEL_URL);
  const projectBodyPoint = useMemo(
    () => createBodySurfaceProjector(scene, HUMAN_POSITION, HUMAN_SCALE),
    [scene],
  );
  const projectedLesions = useMemo(
    () =>
      props.lesions.map((lesion) => ({
        lesion,
        markerPoint: projectBodyPoint(lesion),
      })),
    [projectBodyPoint, props.lesions],
  );

  return (
    <>
      <HumanModel
        disabled={props.disabled || props.busy}
        onCreatePoint={props.onCreatePoint}
        onHoverRegion={onHoverRegion}
      />
      {projectedLesions.map(({ lesion, markerPoint }) => (
        <LesionMarker
          key={lesion.id}
          lesion={lesion}
          markerPoint={markerPoint}
          selected={props.selectedLesionId === lesion.id}
          onSelect={props.onSelectLesion}
          onHover={onHoverLesion}
        />
      ))}
    </>
  );
}

export function BodyMap3D(props: Props) {
  const [viewRequest, setViewRequest] = useState<BodyViewRequest>({
    view: "front",
    revision: 0,
  });
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [hoveredLesionId, setHoveredLesionId] = useState<number | null>(null);
  const [modelFailed, setModelFailed] = useState(false);
  const [modelAttempt, setModelAttempt] = useState(0);
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const cameraControlsRef = useRef<BodyCameraHandle>(null);

  useEffect(() => {
    if (!hoveredRegion && hoveredLesionId === null) return;

    function clearTargetOutsideCanvas(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !canvasShellRef.current?.contains(event.target)
      ) {
        setHoveredRegion(null);
        setHoveredLesionId(null);
      }
    }

    document.addEventListener(
      "pointermove",
      clearTargetOutsideCanvas,
      true,
    );
    return () => {
      document.removeEventListener(
        "pointermove",
        clearTargetOutsideCanvas,
        true,
      );
    };
  }, [hoveredLesionId, hoveredRegion]);
  const status = modelFailed
    ? "3D model unavailable"
    : props.busy
      ? "Saving map position"
      : props.repositioningLesion
        ? `Repositioning ${props.repositioningLesion.lesion_code}`
        : props.disabled
          ? "Select a patient"
          : "Click body to add lesion";
  const selectedLesion =
    props.lesions.find(
      (lesion) => lesion.id === props.selectedLesionId,
    ) ?? null;
  const hoveredLesion =
    props.lesions.find((lesion) => lesion.id === hoveredLesionId) ?? null;

  function retryModelLoad() {
    useGLTF.clear(HUMAN_MODEL_URL);
    setHoveredRegion(null);
    setHoveredLesionId(null);
    setModelAttempt((current) => current + 1);
    setModelFailed(false);
  }

  return (
    <BodyMapFrame
      status={status}
      repositioningCode={
        props.repositioningLesion?.lesion_code ?? null
      }
      selectedLesionCode={
        modelFailed ? null : selectedLesion?.lesion_code ?? null
      }
      busy={props.busy}
      onCancelReposition={props.onCancelReposition}
      onFocusSelected={() => {
        if (!selectedLesion) return;
        setViewRequest((current) => ({
          view: "free",
          revision: current.revision + 1,
          focus: bodyMapFocusPose(selectedLesion),
        }));
      }}
      footer={
        <footer className="bodymap-footer">
          <p className="hint">
            {props.repositioningLesion
              ? "The saved position remains unchanged until the new point is confirmed."
              : "The marker stores location only. Every observation comes from an operator-confirmed lesion image."}
          </p>
          <div className="bodymap-legend" aria-label="Lesion marker legend">
            {LEGEND_ITEMS.map((item) => (
              <span key={item.key}>
                <i
                  className="legend-swatch"
                  style={{ backgroundColor: MARKER_COLORS[item.key].color }}
                />
                {item.label}
              </span>
            ))}
            <span>
              <i className="legend-swatch experimental" />
              Experimental
            </span>
            <span>
              <i className="legend-swatch selected" />
              Selected
            </span>
          </div>
        </footer>
      }
    >
      <div
        ref={canvasShellRef}
        className="canvas-shell"
        onPointerLeave={() => {
          setHoveredRegion(null);
          setHoveredLesionId(null);
        }}
      >
        {modelFailed ? (
          <BodyMapModelError onRetry={retryModelLoad} />
        ) : (
          <>
            <Canvas
              key={modelAttempt}
              camera={{ position: [0, 0, 8.4], fov: 40 }}
              dpr={[1, 1.5]}
              frameloop="demand"
              gl={{ antialias: true, powerPreference: "high-performance" }}
              performance={{ min: 0.5 }}
            >
              <BodyCamera
                ref={cameraControlsRef}
                request={viewRequest}
                onOrbitStart={() => {
                  setHoveredRegion(null);
                  setHoveredLesionId(null);
                }}
                onOrbitEnd={() => {
                  setViewRequest((current) =>
                    current.view === "free"
                      ? current
                      : { ...current, view: "free" },
                  );
                }}
              />
              <hemisphereLight args={["#ffffff", "#65736f", 1.2]} />
              <ambientLight intensity={0.34} />
              <directionalLight
                position={[3.5, 5, 5]}
                intensity={1.7}
              />
              <directionalLight position={[-4, 1, 3]} intensity={0.72} />
              <directionalLight position={[0, 2, -4]} intensity={0.5} />
              <BodyMapModelErrorBoundary
                onError={() => setModelFailed(true)}
              >
                <Suspense
                  fallback={
                    <Html center>
                      <BodyMapModelLoading />
                    </Html>
                  }
                >
                  <BodyScene
                    {...props}
                    onHoverRegion={(region) => {
                      setHoveredLesionId(null);
                      setHoveredRegion(region);
                    }}
                    onHoverLesion={(lesion) => {
                      setHoveredRegion(null);
                      setHoveredLesionId(lesion?.id ?? null);
                    }}
                  />
                </Suspense>
              </BodyMapModelErrorBoundary>
              <ContactShadows
                position={[0, -2.72, 0]}
                opacity={0.22}
                scale={4.4}
                blur={2.5}
                far={1.5}
                frames={1}
                resolution={256}
              />
            </Canvas>
            <BodyViewControls
              activeView={viewRequest.view}
              onSelect={(view) =>
                setViewRequest((current) => ({
                  view,
                  revision: current.revision + 1,
                }))
              }
            />
            {hoveredLesion ? (
              <BodyMapMarkerReadout lesion={hoveredLesion} />
            ) : (
              <BodyMapRegionReadout region={hoveredRegion} />
            )}
            <BodyMapZoomControls
              onZoomIn={() => cameraControlsRef.current?.zoomIn()}
              onZoomOut={() => cameraControlsRef.current?.zoomOut()}
            />
          </>
        )}
      </div>
    </BodyMapFrame>
  );
}

useGLTF.preload(HUMAN_MODEL_URL);
