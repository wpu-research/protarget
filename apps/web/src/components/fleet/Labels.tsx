'use client';
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

/** DOM labels anchored to 3D points. Uses CSS2DRenderer instead of drei's Html (which mounts nested React roots). */
export function LabelRenderer() {
  const { gl, scene, camera, size } = useThree();
  const renderer = useMemo(() => new CSS2DRenderer(), []);
  useEffect(() => {
    const parent = gl.domElement.parentElement;
    const el = renderer.domElement;
    el.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    parent?.appendChild(el);
    return () => { el.remove(); };
  }, [gl, renderer]);
  useEffect(() => { renderer.setSize(size.width, size.height); }, [renderer, size]);
  useFrame(() => { renderer.render(scene, camera); });
  return null;
}

export function Label2D({ text, className, position }: { text: string; className: string; position: [number, number, number] }) {
  const object = useMemo(() => {
    const el = document.createElement('div');
    el.style.pointerEvents = 'none';
    el.appendChild(document.createElement('span'));
    return new CSS2DObject(el);
  }, []);
  useEffect(() => {
    const span = object.element.firstChild as HTMLSpanElement;
    span.textContent = text; span.className = className;
  }, [object, text, className]);
  useEffect(() => () => { object.element.remove(); object.removeFromParent(); }, [object]);
  return <primitive object={object} position={position} />;
}
