import React, { useEffect, useState } from 'react';
import { useApi, identityApiRef } from '@backstage/core-plugin-api';
import { Progress } from '@backstage/core-components';
import { Tooltip, Button, ButtonProps } from '@material-ui/core';

type ConditionalRenderProps = {
  requiredPermission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

/**
 * A component that conditionally renders its children based on whether the user has the required permission.
 *
 * @param requiredPermission - The permission that the user must have to see the children
 * @param children - The content to render if the user has the required permission
 * @param fallback - Optional content to render if the user does not have the required permission
 */
export const ConditionalRender = ({
  requiredPermission,
  children,
  fallback = null,
}: ConditionalRenderProps) => {
  const identityApi = useApi(identityApiRef);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const identity = await identityApi.getBackstageIdentity();

        // Get permissions from the identity claims
        const permissions = ((identity as any).claims?.permissions as string[]) || [];

        // Check if the user has the required permission
        const permitted = permissions.includes(requiredPermission);
        setHasPermission(permitted);
      } catch (error) {
        // Permission check failed; deny access silently
        setHasPermission(false);
      }
    };

    checkPermission();
  }, [identityApi, requiredPermission]);

  // Show loading indicator while checking permissions
  if (hasPermission === null) {
    return <Progress />;
  }

  // Render children if the user has the required permission, otherwise render the fallback
  return hasPermission ? <>{children}</> : <>{fallback}</>;
};

type PermissionButtonProps = ButtonProps & {
  requiredPermission: string;
  disabledMessage?: string;
};

/**
 * A button that is enabled only if the user has the required permission.
 * If the user doesn't have the permission, the button is disabled and shows a tooltip explaining why.
 *
 * @param requiredPermission - The permission that the user must have to enable the button
 * @param disabledMessage - Optional message to show in the tooltip when the button is disabled
 * @param props - Props to pass to the underlying Button component
 */
export const PermissionButton = ({
  requiredPermission,
  disabledMessage,
  ...props
}: PermissionButtonProps) => {
  const identityApi = useApi(identityApiRef);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    const checkPermission = async () => {
      try {
        const identity = await identityApi.getBackstageIdentity();

        // Get permissions from the identity claims
        const permissions = ((identity as any).claims?.permissions as string[]) || [];

        // Check if the user has the required permission
        const permitted = permissions.includes(requiredPermission);
        setHasPermission(permitted);
      } catch (error) {
        // Permission check failed; deny access silently
        setHasPermission(false);
      }
    };

    checkPermission();
  }, [identityApi, requiredPermission]);

  // Show loading indicator while checking permissions
  if (hasPermission === null) {
    return <Progress />;
  }

  // If the user has permission, render the button normally
  if (hasPermission) {
    return <Button {...props} />;
  }

  // Otherwise, render a disabled button with a tooltip
  return (
    <Tooltip
      title={disabledMessage || `You don't have the required permission: ${requiredPermission}`}
      placement="top"
    >
      <span>
        <Button {...props} disabled />
      </span>
    </Tooltip>
  );
};
