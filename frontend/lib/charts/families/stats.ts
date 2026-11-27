// Lazy family chunk: heatmap / boxplot / parallel / radar / calendar.
import * as echarts from 'echarts/core';
import {
  BoxplotChart,
  HeatmapChart,
  ParallelChart,
  RadarChart,
} from 'echarts/charts';
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  ParallelComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  HeatmapChart,
  BoxplotChart,
  ParallelChart,
  RadarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  ParallelComponent,
  CalendarComponent,
  CanvasRenderer,
]);
