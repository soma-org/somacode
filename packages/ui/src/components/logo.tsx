import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
    >
      <g>
        <text
          font-family="Oswald Regular, Oswald, system-ui, sans-serif"
          font-size="28"
          font-style="normal"
          font-weight="normal"
          fill="var(--icon-strong-base)"
          stroke="none"
          paint-order="stroke"
          text-anchor="middle"
          dominant-baseline="central"
          x="10"
          y="8"
        >
          ❍
        </text>
      </g>
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      xmlns="http://www.w3.org/2000/svg"
      width="100"
      height="100"
      viewBox="0 0 100 100"
    >
      <g>
        <text
          font-family="Oswald Regular, Oswald, system-ui, sans-serif"
          font-size="90"
          font-style="normal"
          font-weight="normal"
          fill="var(--icon-strong-base)"
          stroke="none"
          paint-order="stroke"
          text-anchor="middle"
          dominant-baseline="central"
          x="50"
          y="50"
        >
          ❍
        </text>
      </g>
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 234 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M18 30H20V24H0V30Z" fill="var(--icon-weak-base)" />
        <path d="M0 6H24V12H0V6ZM0 12H6V18H0V12ZM0 18H24V24H0V18ZM18 24H24V30H18V24ZM0 30H24V36H0V30Z" fill="var(--icon-base)" />
        <path d="M48 30H36V18H48V30Z" fill="var(--icon-weak-base)" />
        <path d="M48 12H36V30H48V12ZM54 36H30V6H54V36Z" fill="var(--icon-base)" />
        <path d="M78 30H66V18H78V30Z" fill="var(--icon-weak-base)" />
        <path d="M60 6H84V12H60V6ZM60 6H66V36H60V6ZM78 6H84V36H78V6ZM66 6H75V36H69V10Z" fill="var(--icon-base)" />
        <path d="M114 24V30H96V12H114Z" fill="var(--icon-weak-base)" />
        <path d="M90 20H96V36H90V22ZM108 12H114V36H108V12ZM96 6H114V12H90V6ZM90 18H114V24H90V24 30H114V36H90V24ZZ" fill="var(--icon-base)" />
        <path d="M144 30H126V18H144V30Z" fill="var(--icon-weak-base)" />
        <path d="M144 12H126V30H144V36H120V6H144V12Z" fill="var(--icon-strong-base)" />
        <path d="M168 30H156V18H168V30Z" fill="var(--icon-weak-base)" />
        <path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="var(--icon-strong-base)" />
        <path d="M198 30H186V18H198V30Z" fill="var(--icon-weak-base)" />
        <path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="var(--icon-strong-base)" />
        <path d="M234 24V30H216V24H234Z" fill="var(--icon-weak-base)" />
        <path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
