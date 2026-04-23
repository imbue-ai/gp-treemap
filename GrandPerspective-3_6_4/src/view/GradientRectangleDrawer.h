/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>


@interface GradientRectangleDrawer : NSObject {

  NSColorList  *colorPalette;
  float  colorGradient;
  
  BOOL  initGradientColors;
  UInt32  *gradientColors;

  NSRect  bitmapBounds;
  NSBitmapImageRep  *drawBitmap;

}

- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithColorPalette:(NSColorList *)colorPalette NS_DESIGNATED_INITIALIZER;

@property (nonatomic, strong) NSColorList *colorPalette;

/* Sets the color gradient, which determines how much the color of each rectangle varies. The value
 * should be between 0 (uniform color) and 1 (maximum color difference).
 */
@property (nonatomic) float colorGradient;

@property (nonatomic, readonly) NSUInteger numGradientColors;

/* Sets up a bitmap, to be used for drawing
 */
- (void) setupBitmap:(NSRect)bounds;

/* Disposes the bitmap without creating an image. Can be used when the overarching drawing task was
 * cancelled before completing.
 */
- (void) releaseBitmap;

/* Creates an image from the bitmap, and disposes of the bitmap.
 */
- (NSImage *)createImageFromBitmap;


- (UInt32) intValueForColor:(NSColor *)color;

/* Convenience wrapper method, which sets up bitmap, draws a rectangle and creates an image from it
 */
- (NSImage *)drawImageOfGradientRectangleWithColor:(NSUInteger)colorIndex
                            inRect:(NSRect)bounds;

/* Draws on the bitmap, which must have been set up
 */
- (void) drawBasicFilledRect:(NSRect)rect intColor:(UInt32)intColor;

/* Draws on the bitmap, which must have been set up
 */
- (void) drawGradientFilledRect:(NSRect)rect colorIndex:(NSUInteger)colorIndex;

@end
