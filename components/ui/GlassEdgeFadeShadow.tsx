import React from 'react';
import type { OSMaterialRole, OSShadowRole } from './osMaterial';

export const GLASS_EDGE_FADE_STACK_CLASS = 'bambook-shadow-sibling-stack';
export const GLASS_EDGE_FADE_SHADOW_CASTER_CLASS = 'bambook-sibling-shadow-caster';

type GlassEdgeFadeShadowProps = React.HTMLAttributes<HTMLDivElement> & {
  materialRole?: OSMaterialRole;
  shadowRole?: OSShadowRole;
};

const GlassEdgeFadeShadow = React.forwardRef<HTMLDivElement, GlassEdgeFadeShadowProps>(({
  materialRole: _materialRole = 'raisedCard',
  shadowRole: _shadowRole = 'raised',
  className = '',
  children,
  ...props
}, ref) => (
  <div
    ref={ref}
    className={`${GLASS_EDGE_FADE_STACK_CLASS} ${className}`.trim()}
    data-os-shadow-mode="none"
    {...props}
  >
    {children}
  </div>
));

GlassEdgeFadeShadow.displayName = 'GlassEdgeFadeShadow';

export default GlassEdgeFadeShadow;
