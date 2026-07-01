import { createTheme, type MantineColorsTuple } from '@mantine/core';

const brand: MantineColorsTuple = [
  '#ecfff2',
  '#d3fbe0',
  '#a8f4bf',
  '#79ec9c',
  '#58d98a',
  '#37c56f',
  '#269c55',
  '#1c7641',
  '#13502d',
  '#092817',
];

const accent: MantineColorsTuple = [
  '#e9f4ff',
  '#cce4ff',
  '#99c8ff',
  '#66abff',
  '#3d93f7',
  '#267ee1',
  '#1d63b2',
  '#164983',
  '#0f3158',
  '#07192d',
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: {
    brand,
    accent,
    dark: [
      '#C1C2C5',
      '#A6A7AB',
      '#909296',
      '#5C5F66',
      '#373A40',
      '#2C2E33',
      '#25262B',
      '#1A1B1E',
      '#141517',
      '#101113',
    ],
  },
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontWeight: '600',
  },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '8px',
    xl: '10px',
  },
  defaultRadius: 'md',
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
      styles: {
        root: {
          fontWeight: 700,
        },
      },
    },
    TextInput: {
      defaultProps: {
        radius: 'md',
      },
      styles: {
        input: {
          backgroundColor: '#1a1a1f',
          borderColor: 'rgba(255,255,255,0.09)',
        },
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: 'md',
      },
      styles: {
        input: {
          backgroundColor: '#1a1a1f',
          borderColor: 'rgba(255,255,255,0.09)',
        },
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'md',
      },
    },
    Select: {
      styles: {
        input: {
          backgroundColor: '#1a1a1f',
          borderColor: 'rgba(255,255,255,0.09)',
        },
        dropdown: {
          backgroundColor: '#151518',
          borderColor: 'rgba(255,255,255,0.09)',
        },
      },
    },
    SegmentedControl: {
      styles: {
        root: {
          backgroundColor: '#1a1a1f',
          border: '1px solid rgba(255,255,255,0.08)',
        },
        indicator: {
          backgroundColor: 'rgba(88,217,138,0.16)',
          border: '1px solid rgba(88,217,138,0.42)',
        },
      },
    },
  },
});
