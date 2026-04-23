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

#import "OverlayDrawer.h"

#import "FileItem.h"
#import "FilteredTreeGuide.h"
#import "GradientRectangleDrawer.h"
#import "TreeLayoutBuilder.h"

@implementation OverlayDrawer

- (instancetype) initWithScanTree:(DirectoryItem *)scanTreeVal
                     colorPalette:(NSColorList *)colorPalette {
  if (self = [super initWithScanTree: scanTreeVal colorPalette: colorPalette]) {
    overlayColor = [rectangleDrawer intValueForColor: NSColor.lightGrayColor];
  }
  return self;
}

- (NSImage *)drawOverlayImageOfVisibleTree:(FileItem *)visibleTree
                            startingAtTree:(FileItem *)treeRoot
                        usingLayoutBuilder:(TreeLayoutBuilder *)layoutBuilder
                                    inRect:(NSRect) bounds
                               overlayTest:(FileItemTest *)overlayTest; {
  [treeGuide setFileItemTest: overlayTest];

  return [super drawImageOfVisibleTree: visibleTree
                        startingAtTree: treeRoot
                    usingLayoutBuilder: layoutBuilder
                                inRect: bounds];
}

- (void) drawFileItem:(FileItem *)fileItem atRect:(NSRect) rect depth:(int) depth {
  // Plain file that passed the test. Highlight it
  [rectangleDrawer drawBasicFilledRect: rect intColor: overlayColor];
}

@end
