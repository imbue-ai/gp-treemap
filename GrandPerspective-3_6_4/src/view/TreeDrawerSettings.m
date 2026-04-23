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

#import "TreeDrawerSettings.h"

#import "StatelessFileItemMapping.h"
#import "PreferencesPanelControl.h"


@interface TreeDrawerSettings (PrivateMethods)

@property (class, nonatomic, readonly) NSColorList *defaultColorPalette;

@end


@implementation TreeDrawerSettings

- (instancetype) initWithDisplayDepth:(unsigned)displayDepth
                            drawItems:(DrawItemsEnum)drawItems {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;

  return [self initWithColorScheme: [[[StatelessFileItemMapping alloc] init] autorelease]
                      colorPalette: TreeDrawerSettings.defaultColorPalette
                     colorGradient: [userDefaults floatForKey: DefaultColorGradient]
                         drawItems: drawItems
                          maskTest: nil
                      displayDepth: displayDepth];
}


- (instancetype) initWithColorScheme:(NSObject <FileItemMappingScheme> *)colorScheme
                        colorPalette:(NSColorList *)colorPalette
                       colorGradient:(float)colorGradient
                           drawItems:(DrawItemsEnum)drawItems
                            maskTest:(FileItemTest *)maskTest
                        displayDepth:(unsigned)displayDepth {
  if (self = [super initWithDisplayDepth: displayDepth drawItems: drawItems]) {
    _colorScheme = [colorScheme retain];
    _colorPalette = [colorPalette retain];
    _colorGradient = colorGradient;
    _maskTest = [maskTest retain];
  }
  
  return self;
}

- (void) dealloc {
  [_colorScheme release];
  [_colorPalette release];
  [_maskTest release];
  
  [super dealloc];
}


- (instancetype) settingsWithChangedColorScheme:(NSObject <FileItemMappingScheme> *)colorScheme {
  return [[[TreeDrawerSettings alloc] initWithColorScheme: colorScheme
                                             colorPalette: self.colorPalette
                                            colorGradient: self.colorGradient
                                                drawItems: self.drawItems
                                                 maskTest: self.maskTest
                                             displayDepth: self.displayDepth] autorelease];
}

- (instancetype) settingsWithChangedColorPalette:(NSColorList *)colorPalette {
  return [[[TreeDrawerSettings alloc] initWithColorScheme: self.colorScheme
                                             colorPalette: colorPalette
                                            colorGradient: self.colorGradient
                                                drawItems: self.drawItems
                                                 maskTest: self.maskTest
                                             displayDepth: self.displayDepth] autorelease];
}

- (instancetype) settingsWithChangedColorGradient:(float) colorGradient {
  return [[[TreeDrawerSettings alloc] initWithColorScheme: self.colorScheme
                                             colorPalette: self.colorPalette
                                            colorGradient: colorGradient
                                                drawItems: self.drawItems
                                                 maskTest: self.maskTest
                                             displayDepth: self.displayDepth] autorelease];
}

- (instancetype) settingsWithChangedMaskTest:(FileItemTest *)maskTest {
  return [[[TreeDrawerSettings alloc] initWithColorScheme: self.colorScheme
                                             colorPalette: self.colorPalette
                                            colorGradient: self.colorGradient
                                                drawItems: self.drawItems
                                                 maskTest: maskTest
                                             displayDepth: self.displayDepth] autorelease];
}

- (instancetype) settingsWithChangedDisplayDepth:(unsigned) displayDepth {
  return [[[TreeDrawerSettings alloc] initWithColorScheme: self.colorScheme
                                             colorPalette: self.colorPalette
                                            colorGradient: self.colorGradient
                                                drawItems: self.drawItems
                                                 maskTest: self.maskTest
                                             displayDepth: displayDepth] autorelease];
}

- (instancetype) settingsWithChangedShowPackageContents:(BOOL) showPackageContents {
  return [[[TreeDrawerSettings alloc] initWithColorScheme: self.colorScheme
                                             colorPalette: self.colorPalette
                                            colorGradient: self.colorGradient
                                                drawItems: self.drawItems
                                                 maskTest: self.maskTest
                                             displayDepth: self.displayDepth] autorelease];
}

@end // @implementation TreeDrawerSettings


NSColorList  *defaultColorPalette = nil;

@implementation TreeDrawerSettings (PrivateMethods)

+ (NSColorList *)defaultColorPalette {
  if (defaultColorPalette == nil) {
    NSColorList  *colorList = [[NSColorList alloc] initWithName: @"DefaultTreeDrawerPalette"];

    [colorList insertColor: NSColor.blueColor    key: @"blue"    atIndex: 0];
    [colorList insertColor: NSColor.redColor     key: @"red"     atIndex: 1];
    [colorList insertColor: NSColor.greenColor   key: @"green"   atIndex: 2];
    [colorList insertColor: NSColor.cyanColor    key: @"cyan"    atIndex: 3];
    [colorList insertColor: NSColor.magentaColor key: @"magenta" atIndex: 4];
    [colorList insertColor: NSColor.orangeColor  key: @"orange"  atIndex: 5];
    [colorList insertColor: NSColor.yellowColor  key: @"yellow"  atIndex: 6];
    [colorList insertColor: NSColor.purpleColor  key: @"purple"  atIndex: 7];

    defaultColorPalette = colorList;
  }

  return defaultColorPalette;
}

@end // @implementation TreeDrawerSettings (PrivateMethods)
