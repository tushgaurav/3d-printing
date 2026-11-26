// Lucide icons (ISC), the same set the Layer1 screen uses.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowUpRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 7h10v10" />
    <path d="M7 17 17 7" />
  </Icon>
);

export const Home = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);

export const Folder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);

export const Thermometer = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
  </Icon>
);

export const Move = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2v20" />
    <path d="m15 19-3 3-3-3" />
    <path d="m19 9 3 3-3 3" />
    <path d="M2 12h20" />
    <path d="m5 9-3 3 3 3" />
    <path d="m9 5 3-3 3 3" />
  </Icon>
);

export const Grid = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v18" />
    <path d="M3 12h18" />
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </Icon>
);

export const ShieldCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const Copy = (p: IconProps) => (
  <Icon {...p}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>
);

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

// Brand marks (Simple Icons, CC0): filled shapes, not strokes.
function Mark({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const GitHubMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </Mark>
);

export const OctoPrintMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M3.942 4.613C2.424 5.987 1.107 7.473.476 9.71c-.634 2.248-.585 5.094-.145 7.398.44 2.303 1.12 4.107 1.873 5.83h13.179c-.31-.988-.761-1.967-1.446-3.237-.685-1.268-1.658-2.692-2.648-4.178-.99-1.486-1.985-3.077-1.851-4.472.094-.987.49-1.976 1.492-2.76 1.16-.909 2.289-1.437 3.353-1.595 3.325-.496 6.422.601 8.925 3.366.288.316.36.726.545 1.127l.166-.653c.15-.589.088-1.359-.152-2.371-.243-1.029-.563-1.792-1.46-2.973-.893-1.176-2.467-2.322-4.48-3.226-1.5-.673-3.305-1-5.798-.879-2.522.124-5.494 1.177-8.087 3.526Z" />
  </Mark>
);
