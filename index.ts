import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and handles the Expo Go vs. standalone/dev-client entry-point difference.
registerRootComponent(App);
