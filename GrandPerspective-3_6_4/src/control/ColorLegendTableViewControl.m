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

#import "ColorLegendTableViewControl.h"

#import "DirectoryView.h"
#import "ItemPathModel.h"
#import "ItemPathModelView.h"

#import "FileItem.h"
#import "FileItemMapping.h"

#import "GradientRectangleDrawer.h"
#import "TreeDrawerSettings.h"


NSString  *ColorImageColumnIdentifier = @"colorImage";
NSString  *ColorDescriptionColumnIdentifier = @"colorDescription";


@interface ColorLegendTableViewControl (PrivateMethods)

//----
// Partial implementation of NSTableDataSource interface
- (NSInteger) numberOfRowsInTableView:(NSTableView *)tableView;
- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(int)row;
//---- 

- (NSString *)descriptionForRow:(NSUInteger)row;

- (void) makeColorImages;
- (void) updateDescriptionColumnWidth;
- (void) updateSelectedRow;

- (void) colorPaletteChanged:(NSNotification *)notification;
- (void) colorMappingChanged:(NSNotification *)notification;
- (void) selectedItemChanged:(NSNotification *)notification;
- (void) visibleTreeChanged:(NSNotification *)notification;

@end


@implementation ColorLegendTableViewControl

- (instancetype) initWithDirectoryView:(DirectoryView *)dirViewVal
                             tableView:(NSTableView *)tableViewVal {
  if (self = [super init]) {
    dirView = [dirViewVal retain];
    tableView = [tableViewVal retain];
    
    NSArray  *columns = tableView.tableColumns;
    
    NSTableColumn  *imageColumn = columns[0];
    imageColumn.identifier = ColorImageColumnIdentifier;
    [imageColumn setEditable: NO];

    NSImageCell  *imageCell = [[[NSImageCell alloc] initImageCell: nil] autorelease];
    imageColumn.dataCell = imageCell;
    
    NSTableColumn  *descrColumn = columns[1];
    descrColumn.identifier = ColorDescriptionColumnIdentifier;
    [descrColumn setEditable: NO];
    
    colorImages = nil;
    [self makeColorImages];
    [self updateDescriptionColumnWidth];
    
    tableView.dataSource = self;

    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
    [nc addObserver: self
           selector: @selector(colorPaletteChanged:)
               name: ColorPaletteChangedEvent
             object: dirView];
    [nc addObserver: self
           selector: @selector(colorMappingChanged:)
               name: ColorMappingChangedEvent
             object: dirView];
    [nc addObserver: self
           selector: @selector(selectedItemChanged:)
               name: SelectedItemChangedEvent
             object: dirView.pathModelView];
    [nc addObserver: self
           selector: @selector(visibleTreeChanged:)
               name: VisibleTreeChangedEvent
             object: dirView.pathModelView];
  }
  
  return self;
}

- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  
  [dirView release];
  [tableView release];
  [colorImages release];
  
  [super dealloc];
}

@end // @implementation ColorLegendTableViewControl


@implementation ColorLegendTableViewControl (PrivateMethods)

//-----------------------------------------------------------------------------
// Partial implementation of NSTableDataSource interface

- (NSInteger) numberOfRowsInTableView:(NSTableView *)tableView {
  return colorImages.count;
}

- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(int)row {
  if (column.identifier == ColorImageColumnIdentifier) {
    return colorImages[row];
  }
  else if (column.identifier == ColorDescriptionColumnIdentifier) {
    return [self descriptionForRow: row];
  }
  else {
    NSAssert(NO, @"Unexpected column.");
    return nil;
  }
}


//-----------------------------------------------------------------------------

- (NSString *)descriptionForRow:(NSUInteger)row {
  FileItemMapping  *colorMapper = dirView.colorMapper;

  return [colorMapper legendForColorIndex: row numColors: colorImages.count];
}


- (void) makeColorImages {
  NSColorList  *colorPalette = dirView.treeDrawerSettings.colorPalette;
  GradientRectangleDrawer  *drawer = 
    [[[GradientRectangleDrawer alloc] initWithColorPalette: colorPalette] autorelease];
  
  NSUInteger  numColors = colorPalette.allKeys.count;
  [colorImages release];
  colorImages = [[NSMutableArray alloc] initWithCapacity: numColors];

  NSTableColumn  *imageColumn = [tableView tableColumnWithIdentifier: ColorImageColumnIdentifier];
  NSRect  bounds = NSMakeRect(0, 0, imageColumn.width, tableView.rowHeight);

  if (bounds.size.width > 0 && bounds.size.height > 0) {
    int  i = 0;
    while (i < numColors) {
      [colorImages addObject: [drawer drawImageOfGradientRectangleWithColor: i inRect: bounds]];
      i++;
    }
  }
}

- (void) updateDescriptionColumnWidth {
  NSTableColumn  *descrColumn =
    [tableView tableColumnWithIdentifier: ColorDescriptionColumnIdentifier];
  NSCell  *dataCell = descrColumn.dataCell;
  
  // TODO: Determine if more attributes need to be provided for sizeWithAttributes: to always return
  // the right width. So far, it appears as if the font is all that is needed.
  NSDictionary  *attribs = @{ NSFontAttributeName: dataCell.font };

  NSUInteger  numColors = colorImages.count;
  float  maxWidth = 0;
  for (int i = 0; i < numColors; ++i) {
    NSString  *descr = [self descriptionForRow: i];

    if (descr != nil) {
      maxWidth = MAX(maxWidth, [descr sizeWithAttributes: attribs].width);
    }
  }
  
  // Increase for the space at the right and left.
  // TODO: Is there a way to get the exact value dynamically?
  maxWidth += 6;
  
  descrColumn.maxWidth = maxWidth;
  descrColumn.width = maxWidth;
}


/* Update the selected row in the color legend table. When the selected item is a plain file, its
 * color is selected. Otherwise, the selection is cleared.
 */
- (void) updateSelectedRow {
  FileItem  *selectedItem = dirView.pathModelView.selectedFileItem;

  BOOL  rowSelected = NO;

  if (selectedItem != nil && selectedItem.isPhysical) {
    FileItemMapping  *colorMapper = dirView.colorMapper;

    if (colorMapper.providesLegend) {
      NSUInteger  hash = [colorMapper hashForFileItem: selectedItem inTree: dirView.treeInView];
      NSUInteger  row = [colorMapper colorIndexForHash: hash numColors: tableView.numberOfRows];
      
      [tableView selectRowIndexes: [NSIndexSet indexSetWithIndex: row]
             byExtendingSelection: NO];
      rowSelected = YES;
    }
  }
  if ( !rowSelected ) {
    [tableView deselectAll: self];
  }
}


- (void) colorPaletteChanged:(NSNotification *)notification {
  [self makeColorImages];

  // As the number of colors may have changed, the longest description may have changed as well.
  [self updateDescriptionColumnWidth];

  [tableView reloadData];

  [self updateSelectedRow];
}

- (void) colorMappingChanged:(NSNotification *)notification {
  [self updateDescriptionColumnWidth];
  [tableView reloadData];

  [self updateSelectedRow];
}

- (void) selectedItemChanged:(NSNotification *)notification {
  [self updateSelectedRow];
}


- (void) visibleTreeChanged:(NSNotification *)notification {
  // A change of the visible tree changes the level of the selected file item, which may affect its
  // color.
  [self updateSelectedRow];
}

@end // @implementation ColorLegendTableViewControl (PrivateMethods)
