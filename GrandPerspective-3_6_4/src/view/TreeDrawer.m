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

#import "TreeDrawer.h"

#import "DirectoryItem.h"
#import "FileItemMapping.h"
#import "FileItemMappingScheme.h"
#import "FilteredTreeGuide.h"
#import "GradientRectangleDrawer.h"
#import "TreeDrawerSettings.h"


@interface TreeDrawer (PrivateMethod)

- (void) colorSchemeChanged:(NSNotification *)notification;

@end // @interface TreeDrawer (PrivateMethod)

@implementation TreeDrawer

// Overrides designated initialiser of base class
- (instancetype) initWithScanTree:(DirectoryItem *)scanTreeVal
                     colorPalette:(NSColorList *)colorPalette {
  TreeDrawerSettings  *settings = [[[TreeDrawerSettings alloc] init] autorelease];
  if (colorPalette) {
    settings = [settings settingsWithChangedColorPalette: colorPalette];
  }

  return [self initWithScanTree: scanTreeVal treeDrawerSettings: settings];
}

- (instancetype) initWithScanTree:(DirectoryItem *)scanTreeVal
               treeDrawerSettings:(TreeDrawerSettings *)settings {
  if (self = [super initWithScanTree: scanTreeVal
                        colorPalette: settings.colorPalette]) {
    [self updateSettings: settings];
    
    freeSpaceColor = [rectangleDrawer intValueForColor: NSColor.blackColor];
    usedSpaceColor = [rectangleDrawer intValueForColor: NSColor.darkGrayColor];
    visibleTreeBackgroundColor = [rectangleDrawer intValueForColor: NSColor.grayColor];
  }
  return self;
}

- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];

  [_colorMapper release];
  [_colorScheme release];

  [super dealloc];
}


- (void) setColorScheme:(NSObject <FileItemMappingScheme> *)colorScheme {
  if (colorScheme != _colorScheme) {
    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;

    [nc removeObserver: self
                  name: MappingSchemeChangedEvent
                object: _colorScheme];

    [_colorScheme release];
    _colorScheme = [colorScheme retain];

    [nc addObserver: self
           selector: @selector(colorSchemeChanged:)
               name: MappingSchemeChangedEvent
             object: _colorScheme];

    [self colorSchemeChanged: nil];
  }
}


- (void) setMaskTest:(FileItemTest *)maskTest {
  [treeGuide setFileItemTest: maskTest];
}

- (FileItemTest *)maskTest {
  return treeGuide.fileItemTest;
}


- (void) updateSettings:(TreeDrawerSettings *)settings {
  [super updateSettings: settings];

  self.colorScheme = settings.colorScheme;

  [rectangleDrawer setColorPalette: settings.colorPalette];
  [rectangleDrawer setColorGradient: settings.colorGradient];
  [self setMaskTest: settings.maskTest];
}


// Overrides of protected methods

- (void) drawVisibleTreeAtRect:(FileItem *)visibleTree rect:(NSRect) rect {
  [rectangleDrawer drawBasicFilledRect: rect intColor: visibleTreeBackgroundColor];
}

- (void) drawUsedSpaceAtRect:(NSRect) rect {
  [rectangleDrawer drawBasicFilledRect: rect intColor: usedSpaceColor];
}

- (void) drawFreeSpaceAtRect:(NSRect) rect {
  [rectangleDrawer drawBasicFilledRect: rect intColor: freeSpaceColor];
}

- (void) drawFreedSpaceAtRect:(NSRect) rect {
  [rectangleDrawer drawBasicFilledRect: rect intColor: freeSpaceColor];
}

- (void) drawFileItem:(FileItem *)fileItem atRect:(NSRect) rect depth:(int) depth {
  NSUInteger  hash = [_colorMapper hashForFileItem: fileItem atDepth: depth];
  NSUInteger  colorIndex = [_colorMapper colorIndexForHash: hash
                                                 numColors: rectangleDrawer.numGradientColors];

  [rectangleDrawer drawGradientFilledRect: rect colorIndex: colorIndex];
}

@end // @implementation TreeDrawer

@implementation TreeDrawer (PrivateMethod)

- (void) colorSchemeChanged:(NSNotification *)notification {
  self.colorMapper = [self.colorScheme fileItemMappingForTree: scanTree];

  // Indicate if the trigger was internal (the same scheme is still active, but something changed
  // internally that may impact the mapping) or external (a different scheme was configured)
  BOOL  isInternal = notification != nil;
  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
  [nc postNotificationName: ColorMappingChangedEvent
                    object: self
                  userInfo: @{@"isInternal": [NSNumber numberWithBool: isInternal]}];
}

@end // @implementation TreeDrawer (PrivateMethod)
