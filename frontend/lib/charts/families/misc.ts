// Lazy family chunk: funnel / gauge / themeRiver / graph / custom
// (chord, status matrix, timeline) — T2 manual picks apart from funnel.
import * as echarts from 'echarts/core';
import {
  CustomChart,
  FunnelChart,
  GaugeChart,
  GraphChart,
  ThemeRiverChart,
} from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  FunnelChart,
  GaugeChart,
  ThemeRiverChart,
  GraphChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);
